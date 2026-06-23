import logging
from datetime import datetime
from typing import List, Dict

import pyarrow as pa
import pyarrow.compute as pc

def letter_filter(start_char: str, end_char: str, table: pa.Table) -> pa.Table:
    """Filters a table based on the first letter of the 'Symbol' column.

    Includes rows where the first character of the trimmed 'Symbol'
    is within the specified inclusive range.

    Args:
        start_char: The starting character of the range (e.g., 'A').
        end_char: The ending character of the range (e.g., 'K').
        table: The input PyArrow table to filter.

    Returns:
        The filtered PyArrow table.
    """
    logging.info("    Filtering based on the first letter of the Symbol values")
    symbol_col = pc.utf8_trim_whitespace(table['Symbol'])
    first_chars = pc.utf8_slice_codeunits(symbol_col, 0, 1)
    filter_expression = pc.and_(
        pc.greater_equal(first_chars, start_char),
        pc.less_equal(first_chars, end_char)
    )
    return table.filter(filter_expression)

def symbol_conv(table: pa.Table) -> pa.Table:
    """Cleans the 'Symbol' column by replacing whitespace with dots.

    Args:
        table: The input PyArrow table.

    Returns:
        The table with the modified 'Symbol' column.
    """
    logging.info("    Converting the Symbol column")
    symbol_col = pc.replace_substring_regex(
        table['Symbol'],
        pattern=r'\s+',
        replacement='.')
    return table.set_column(
        table.schema.get_field_index('Symbol'), 'Symbol', symbol_col)

def trim_dict_encode(trim_cols: List[str], table: pa.Table) -> pa.Table:
    """Trims whitespace and dictionary-encodes specified string columns.

    Args:
        trim_cols: A list of column names to process.
        table: The input PyArrow table.

    Returns:
        The table with the modified columns.
    """
    logging.info("    Trimming and dictionary encoding some columns")
    for col_name in trim_cols:
        trimmed_col = pc.utf8_trim_whitespace(table[col_name])
        casted_column = trimmed_col.cast(pa.dictionary(pa.int32(), pa.string()))
        table = table.set_column(table.schema.get_field_index(col_name), col_name, casted_column)
    return table

def convert_time_string_array_to_duration_ns(time_strings: pa.Array) -> pa.Array:
    """
    Converts a pa.Array of strings 'HHMMSSNNNNNNNNN' to a pa.Array of duration(ns).
    HH=hours, MM=minutes, SS=seconds, NNNNNNNNN=nanoseconds (9 digits)

    This function is designed for high performance using PyArrow compute
    functions. It handles empty strings ('') as null values.

    Note:
        Assumes a strict 15-character format (or empty string).
        Malformed, non-empty strings may cause errors.

    Args:
        time_strings: A PyArrow string array with time values.

    Returns:
        A PyArrow array of type `pa.time64('ns')`.
    """

    null_idx = pc.equal(time_strings, '')
    # Replace nulls with a valid-format string to avoid slice errors
    time_strings_safe = pc.if_else(
        null_idx,
        pa.scalar('000000000000000'),
        time_strings
    )

    hours   = pc.cast(pc.utf8_slice_codeunits(time_strings_safe, 0, 2), pa.int64())
    minutes = pc.cast(pc.utf8_slice_codeunits(time_strings_safe, 2, 4), pa.int64())
    seconds = pc.cast(pc.utf8_slice_codeunits(time_strings_safe, 4, 6), pa.int64())
    nanos   = pc.cast(pc.utf8_slice_codeunits(time_strings_safe, 6, 15), pa.int64())

    NS_PER_HOUR   = 3_600_000_000_000
    NS_PER_MINUTE =    60_000_000_000
    NS_PER_SECOND =     1_000_000_000

    total_ns = pc.add(
        pc.add(
            pc.add(
                pc.multiply(hours,   pa.scalar(NS_PER_HOUR,   pa.int64())),
                pc.multiply(minutes, pa.scalar(NS_PER_MINUTE, pa.int64()))
            ),
            pc.multiply(seconds, pa.scalar(NS_PER_SECOND, pa.int64()))
        ),
        nanos
    )
    return pc.if_else(null_idx, None, pc.cast(total_ns, pa.duration("ns")))

def convert_time_strings_to_duration_ns(time_cols: List[str], table: pa.Table) -> pa.Table:
    """Applies `duration[ns]` conversion to multiple time columns in a table.

    Args:
        time_cols: List of column names to convert.
        table: The input PyArrow table.

    Returns:
        The table with converted time columns.
    """
    logging.info("    Converting some string columns to duration columns")
    for col_name in time_cols:
        time_col = convert_time_string_array_to_duration_ns(table[col_name])
        table = table.set_column(table.schema.get_field_index(col_name), col_name, time_col)
    return table

def convert_date_strings_to_date32(date_cols: List[str], table: pa.Table) -> pa.Table:
    """Converts 'YYYYMMDD' string columns to `pa.date32`.

    Handles empty strings as nulls.

    Args:
        date_cols: List of column names to convert.
        table: The input PyArrow table.

    Returns:
        The table with converted date columns.
    """
    logging.info("    Converting some string columns to date32 columns")
    for col_name in date_cols:
        date_col = pc.strptime(pc.if_else(
                pc.equal(pc.utf8_length(table[col_name]), 0), None, table[col_name]
                ),
                format="%Y%m%d",
                unit="s"
                )
        table = table.set_column(table.schema.get_field_index(col_name), col_name, date_col)
    return table

def add_date_column(date: datetime, table: pa.Table) -> pa.Table:
    """Adds a 'date' column to the table based on the filename.

    This 'date' column is intended for Hive partitioning.

    Args:
        date: The date values of the column to add.
        table: The input PyArrow table.

    Returns:
        The table with the new 'date' column. If no date is found
        in the filename, the column will be all nulls.
    """
    logging.info("    Adding date column")
    date_array = pa.array([date.date()] * len(table), type=pa.date32())
    return table.append_column('date', date_array)

def rename(colMap: Dict, table: pa.Table) -> pa.Table:
    return table.rename_columns(colMap)

def test_symbol_filter(test_symbols: pa.Array, table: pa.Table) -> pa.Table:
    """Filtering out test symbol entries.

    Args:
        test_symbols: an array of the test symbols
        table: The input PyArrow table.

    Returns:
        The table without test symbols.
    """
    logging.info("    Filtering out test symbol entries")
    return table.filter(pc.invert(pc.is_in(table['Symbol'], test_symbols)))
