#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyarrow>=13.0.0",
#   "toolz>=0.8.0",
# ]
# ///

"""
Script to parse NYSE TAQ PSV files, transform data using PyArrow,
and persist to a hive-partitioned Parquet dataset.

Environment variables:
    SYMBOLSTOREDAS      PartitionColumn or RowGroup
    MINROWGROUPSIZE     Only row groups of size at least MINROWGROUPSIZE will be created. For SYMBOLSTOREDAS=PartitionColumn this is just a hint.
    MAXROWGROUPSIZE     Only row groups of size at most MAXROWGROUPSIZE will be created. For SYMBOLSTOREDAS=PartitionColumn this is just a hint.

    COMPRESSION         Compression algorithm to be used when persisting data, e.g. ZSTD
    COMPRESSION_LEVEL   Level of compression, e.g. 10
    PAGE_SIZE           Page size as power of 2 between 12 and 20. Value e.g. 17 means 128KB.
                        The pyarrow default is 1 MB page size which corresponds to PAGE_SIZE value 20
"""

import os
import argparse
import logging
import sys
from datetime import datetime
from pathlib import Path
from functools import partial

from toolz import pipe

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as csv
import pyarrow.dataset as ds
import pyarrow.parquet as pq

import table_converters as conv
from schemas import MASTER_SCHEMA, MASTERRENAME, EXNAMES, TRADE_SCHEMA, TRADERENAME, QUOTE_SCHEMA, QUOTERENAME

PARSE_OPTIONS = csv.ParseOptions(delimiter='|')


def identity(x):
    return x


def get_convert_options(schema: pa.Schema) -> pa.csv.ConvertOptions:
    """Creates CSV convert options for a given schema.

    Sets up column types, boolean true/false values, and date parsers
    based on the input schema.

    Args:
        schema: The PyArrow schema to use for column type conversion.

    Returns:
        A PyArrow `csv.ConvertOptions` object.
    """
    return csv.ConvertOptions(
        column_types=schema,
        include_columns=schema.names,

        true_values=['Y', '1'],
        false_values=['N', '0'],

        timestamp_parsers=["%Y%m%d"]
    )

def get_write_options(sort_idx: int) -> dict[str, str | int]:
    """Get file write options (e.g. compression algorithm) based on environment variables.
    """
    compression = os.getenv('COMPRESSION')
    write_kwargs = {}
    if compression:
        logging.info("Setting parquet compression to %s", compression)
        write_kwargs['compression'] = compression

        compression_level = os.getenv('COMPRESSION_LEVEL')
        if compression_level:
            logging.info("Setting parquet compression level to %s", compression_level)
            write_kwargs['compression_level'] = int(compression_level)
    else:
        write_kwargs['compression'] = 'NONE'

    write_kwargs['sorting_columns'] = [pq.SortingColumn(sort_idx)]

    page_size = os.getenv('PAGE_SIZE')
    if page_size:
        ps =  2 ** int(page_size)
        if ps > 1024*1024:
            logging.warning("Page size value larger than 1 MB: %s", ps)
        logging.info("Setting parquet page size to %s", ps)
        write_kwargs['data_page_size'] = ps

    return write_kwargs

def parse_and_convert(file_path: Path, schema: pa.Schema, convs: list) -> pa.Table:
    """Parses a PSV file into a Pyarrow table and applies a list of transformation function on the table.

    Args:
        file_path: Path to the input PSV file.
        schema: The PyArrow schema for reading the file.
        conv: A list of transformation functions to pipe the table through.

    Returns:
        The parsed and transformed table.
    """
    convert_options = get_convert_options(schema)
    logging.info("  Parsing file %s", file_path)

    table = csv.read_csv(
        file_path,
        parse_options=PARSE_OPTIONS,
        convert_options=convert_options,
        # encoding should be ascii or utf-8 but Security_Description
        # may contain invalid characters
        read_options=csv.ReadOptions(encoding='latin1')
    )
    logging.info("  Renaming and converting")
    return pipe(table, *convs)

def persist_rowgroup_per_symbol(table: pa.Table, table_output_path: Path,
                              parquet_options: dict[str, str | int],
                              minrowgroupsize: int, maxrowgroupsize: int) -> None:
    """Persists a Pyarrow table to a date-partitioned (following Hive format) Parquet dataset
    in which each row group belong to a Symbol
    Args:
        table: The table to persist
        table_output_path: The root directory for the output Parquet dataset.
        parquet_options: Parquet format options
    """
    if len(table) == 0:
        logging.info("  No rows after converting. Nothing to save.")
        return

    logging.info("  Saving %s rows", len(table))

    symbols = table.column("sym")
    date = table.column("date")[0].as_py().strftime('%Y-%m-%d') # TODO: make it more robust
    table = table.drop(['date'])
    date_partition_dir = table_output_path / f"date={date}"
    date_partition_dir.mkdir(parents=True, exist_ok=True)
    with pq.ParquetWriter(date_partition_dir / "part-0.parquet", table.schema,
                          **parquet_options) as writer:
        start_idx = 0
        current_symbol = symbols[0]

        for i, symbol in enumerate(symbols):
            if symbol != current_symbol:
                if i - start_idx >= minrowgroupsize:
                    writer.write(table.slice(start_idx, i - start_idx), row_group_size=maxrowgroupsize)
                    start_idx = i
                current_symbol = symbol

        # Write the final row group
        writer.write(table.slice(start_idx), row_group_size = maxrowgroupsize)

    logging.info("  Successfully wrote data to %s", table_output_path)

def persist_hive(table: pa.Table, table_output_path: Path,
            parquet_options: dict[str, str | int],
            minrowgroupsize: int, maxrowgroupsize: int) -> None:
    """Persists a Pyarrow table to a Hive-partitioned Parquet dataset.
    Args:
        table: The table to persist
        table_output_path: The root directory for the output Parquet dataset.
        parquet_options: Parquet format options
    """
    if len(table) == 0:
        logging.info("  No rows after converting. Nothing to save.")
        return

    logging.info("  Saving %s rows", len(table))

    partition_schema=pa.schema([('date', pa.date32()), ('sym', pa.string())])
    ds.write_dataset(
        table,
        base_dir=table_output_path,
        format='parquet',
        partitioning=ds.partitioning(partition_schema, flavor='hive'),
        max_partitions=15000,
        existing_data_behavior='overwrite_or_ignore',
        file_options=ds.ParquetFileFormat().make_write_options(**parquet_options),
        min_rows_per_group=minrowgroupsize,
        max_rows_per_group=maxrowgroupsize,
        preserve_order=True # Assumes original data is sorted by Time
    )

    logging.info("  Successfully wrote data to %s", table_output_path)

def main(date: datetime, src: Path, dst: Path, letters: str, includetestsymbols: bool) -> None:
    """Main entry point to find, process, and persist all data files.

    Args:
        src: Directory containing the input PSV files.
        dst: Directory to save the output Parquet files.
        letters: Letter range (e.g., "A-K") to filter symbols.

    Raises:
        SystemExit: If the source directory is invalid or the 'letters'
                    argument is malformed.
    """
    symbolstoredas = os.getenv('SYMBOLSTOREDAS')
    if symbolstoredas is not None and symbolstoredas.upper() not in ("ROWGROUP", "PARTITIONCOLUMN"):
        logging.error("Unknown value for SYMBOLSTOREDAS environment variable: %s", symbolstoredas)
        sys.exit(2)

    start_time = datetime.now()
    if not src.is_dir():
        logging.error("Error: Data directory '%s' not found or is not a directory.", src)
        sys.exit(1)

    dst.mkdir(parents=True, exist_ok=True)

    logging.info("Saving exchange names...")
    pq.write_table(pa.table({'ex': EXNAMES.keys(), 'name': EXNAMES.values()}), dst / 'exnames.parquet', compression='NONE')

    if letters == "A-Z":
        first_letter_filter = identity
    else:
        try:
            start_char, end_char = letters.split('-')
            if len(start_char) != 1 or len(end_char) != 1:
                 raise ValueError("Range must consist of single characters.")
            first_letter_filter = partial(conv.letter_filter, start_char, end_char)
        except ValueError:
            logging.error(
                "Invalid letter parameter: '%s'. Must be in form START-END "
                "(e.g., A-K or L-Z).",
                letters
            )
            sys.exit(1)

    datestr = date.strftime('%Y%m%d')

    logging.info("Processing master table")
    master_file = src / f"EQY_US_ALL_REF_MASTER_{datestr}.psv"

    # no compression for the small master table
    master = parse_and_convert(master_file, MASTER_SCHEMA, [first_letter_filter])
    if includetestsymbols:
        master_extra_conv = extra_conv = identity
    else:
        test_symbols = master['Symbol'].filter(master['Test_Symbol_Flag'])
        master_extra_conv = lambda t: t.filter(pc.invert(t['Test_Symbol_Flag']))
        extra_conv = partial(conv.test_symbol_filter, test_symbols)

    master_conv = [master_extra_conv, conv.symbol_conv,
                   partial(conv.convert_date_strings_to_date32, ['Effective_Date']),
                   partial(conv.add_date_column, date), partial(conv.rename, MASTERRENAME)]
    master = pipe(master, *master_conv)
    parquet_options_master = {'compression': 'NONE'}
    if len(master) == 0:
        logging.info("  No rows after converting. Nothing to save. exiting")
        sys.exit()
    logging.info("  Saving %s rows", len(master))
    ds.write_dataset(
                master,
                base_dir=dst / 'master',
                format='parquet',
                partitioning=ds.partitioning(pa.schema([('date', pa.date32())]), flavor='hive'),
                existing_data_behavior='overwrite_or_ignore',
                file_options=ds.ParquetFileFormat().make_write_options(**parquet_options_master),
            )
    logging.info("  Successfully wrote data to %s",  dst / 'master')
    del master

    minrowgroupsize = int(os.getenv('MINROWGROUPSIZE', '0'))
    maxrowgroupsize = int(os.getenv('MAXROWGROUPSIZE', str(64 * 1024 * 1024)))

    logging.info("Processing quote tables")
    quote_files = list(src.glob(f"SPLITS_US_ALL_BBO_[{letters}]_{datestr}.psv"))  # first letter filter happens here
    quote_conv = [extra_conv, conv.symbol_conv,
            partial(conv.trim_dict_encode, ['FINRA_BBO_Indicator']),
            partial(conv.convert_time_strings_to_duration_ns, ['Time', 'Participant_Timestamp', 'FINRA_ADF_Timestamp']),
            partial(conv.add_date_column, date), partial(conv.rename, QUOTERENAME)]
    parquet_options_quote = get_write_options(QUOTE_SCHEMA.get_field_index('Time'))

    if symbolstoredas is None or symbolstoredas.upper() == "ROWGROUP":
        if quote_files:
            quote_tables = [parse_and_convert(file_path, QUOTE_SCHEMA, quote_conv) for file_path in quote_files]
            quote = pa.concat_tables(quote_tables)
            del quote_tables
            persist_rowgroup_per_symbol(quote, dst / 'quote', parquet_options_quote, minrowgroupsize, maxrowgroupsize)
            del quote
    else:
        for file_path in quote_files:
            persist_hive(parse_and_convert(file_path, QUOTE_SCHEMA, quote_conv), dst / 'quote',
                        parquet_options_quote, minrowgroupsize, maxrowgroupsize)

    logging.info("Processing trade tables")
    trade_file = src / f"EQY_US_ALL_TRADE_{datestr}.psv"
    trade_conv = [first_letter_filter, extra_conv, conv.symbol_conv,
        partial(conv.trim_dict_encode, ['Sale Condition']),
        partial(conv.convert_time_strings_to_duration_ns, ['Time', 'Participant Timestamp', 'Trade Reporting Facility TRF Timestamp']),
        partial(conv.add_date_column, date), partial(conv.rename, TRADERENAME)]
    parquet_options_trade = get_write_options(TRADE_SCHEMA.get_field_index('Time'))
    trade = parse_and_convert(trade_file, TRADE_SCHEMA, trade_conv)
    if symbolstoredas is None or symbolstoredas.upper() == "PARTITIONCOLUMN":
        persist_hive(trade, dst / 'trade', parquet_options_trade, minrowgroupsize, maxrowgroupsize)
    else:
        persist_rowgroup_per_symbol(trade, dst / 'trade', parquet_options_trade, minrowgroupsize, maxrowgroupsize)

    elapsed = datetime.now() - start_time
    logging.info("\nAll processing completed in %s", elapsed)

def parse_yyyymmdd(date_str: str):
    """
    Converts a YYYYMMDD string to a datetime.datetime object.

    Args:
        date_str: The date string in 'YYYYMMDD' format (e.g., '20250701').

    Returns:
        A datetime.datetime object.
    """
    try:
        return datetime.strptime(date_str, '%Y%m%d')
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"Invalid date format: '{date_str}'. Expected YYYYMMDD (e.g., 20250701)."
        )

if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description="Parses NYSE TAQ PSV files and persists to a partitioned Parquet dataset.",
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument(
        '-date', type=parse_yyyymmdd, required=True,
         help="Date to process in YYYYMMDD format, e.g. 20250701."
    )
    parser.add_argument(
        '-src', type=Path, required=True,
        help="Directory containing the input PSV files."
    )
    parser.add_argument(
        '-dst', type=Path, default='parquetDB',
        help="Directory to save the output Parquet files. Defaults to 'parquetDB'."
    )

    parser.add_argument(
        '-letters', type=str, default='A-Z',
        help="Symbol range to process, e.g., 'A-K'. Defaults to 'A-Z'."
    )

    parser.add_argument(
        '-includetestsymbols', action='store_true',
        help="True if test symbols should be skipped. Defaults to False."
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.StreamHandler(sys.stdout)
        ]
    )

    main(args.date, args.src, args.dst, args.letters.upper(), args.includetestsymbols)
