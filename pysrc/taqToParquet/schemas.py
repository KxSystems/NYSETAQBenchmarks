from typing import Final, Dict

import pyarrow as pa

# Table master: EQY_US_ALL_REF_MASTER_*.csv
MASTER_SCHEMA: Final[pa.Schema] = pa.schema([
    pa.field('Symbol', pa.string()),
    pa.field('Security_Description', pa.string()),
    pa.field('CUSIP', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Security_Type', pa.dictionary(pa.int32(), pa.string())),
    pa.field('SIP_Symbol', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Old_Symbol', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Test_Symbol_Flag', pa.bool_()),
    pa.field('Listed_Exchange', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Tape', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Unit_Of_Trade', pa.uint16()),
    pa.field('Round_Lot', pa.uint16()),
    pa.field('NYSE_Industry_Code', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Shares_Outstanding', pa.float64()),
    pa.field('Halt_Delay_Reason', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Specialist_Clearing_Agent', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Specialist_Clearing_Number', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Specialist_Post_Number', pa.int16()),
    pa.field('Specialist_Panel', pa.dictionary(pa.int32(), pa.string())),
    pa.field('TradedOnNYSEMKT', pa.bool_()),
    pa.field('TradedOnNASDAQBX', pa.bool_()),
    pa.field('TradedOnNSX', pa.bool_()),
    pa.field('TradedOnFINRA', pa.bool_()),
    pa.field('TradedOnISE', pa.bool_()),
    pa.field('TradedOnEdgeA', pa.bool_()),
    pa.field('TradedOnEdgeX', pa.bool_()),
    pa.field('TradedOnNYSETexas', pa.bool_()),
    pa.field('TradedOnNYSE', pa.bool_()),
    pa.field('TradedOnArca', pa.bool_()),
    pa.field('TradedOnNasdaq', pa.bool_()),
    pa.field('TradedOnCBOE', pa.bool_()),
    pa.field('TradedOnPSX', pa.bool_()),
    pa.field('TradedOnBATSY', pa.bool_()),
    pa.field('TradedOnBATS', pa.bool_()),
    pa.field('TradedOnIEX', pa.bool_()),
    pa.field('Tick_Pilot_Indicator', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Effective_Date', pa.string()),  # transformed to: pa.date32()
    pa.field('TradedOnLTSE', pa.bool_()),
    pa.field('TradedOnMEMX', pa.bool_()),
    pa.field('TradedOnMIAX', pa.bool_())
])

MASTERRENAME: Dict = {
    'Symbol': 'sym',
    'Security_Description': 'description',
    'CUSIP': 'cusip',
    'Security_Type': 'securityType',
    'SIP_Symbol': 'SIPSymbol',
    'Old_Symbol': 'oldSym',
    'Test_Symbol_Flag': 'testSymFlag',
    'Listed_Exchange': 'ex',
    'Tape': 'tap',
    'Unit_Of_Trade': 'unit',
    'Round_Lot': 'roundLot',
    'NYSE_Industry_Code': 'NYSEIndustryCode',
    'Shares_Outstanding': 'sharesOutstanding',
    'Halt_Delay_Reason': 'haltDelayReason',
    'Specialist_Clearing_Agent': 'specialistClearingAgent',
    'Specialist_Clearing_Number': 'specialistClearingNumber',
    'Specialist_Post_Number': 'specialistPostNumber',
    'Specialist_Panel': 'specialistPanel',
    'TradedOnNYSEMKT': 'tradedOnNYSEMKT',
    'TradedOnNASDAQBX': 'tradedOnNASDAQBX',
    'TradedOnNSX': 'tradedOnNSX',
    'TradedOnFINRA': 'tradedOnFINRA',
    'TradedOnISE': 'tradedOnISE',
    'TradedOnEdgeA': 'tradedOnEdgeA',
    'TradedOnEdgeX': 'tradedOnEdgeX',
    'TradedOnNYSETexas': 'tradedOnNYSETexas',
    'TradedOnNYSE': 'tradedOnNYSE',
    'TradedOnArca': 'tradedOnArca',
    'TradedOnNasdaq': 'tradedOnNasdaq',
    'TradedOnCBOE': 'tradedOnCBOE',
    'TradedOnPSX': 'tradedOnPSX',
    'TradedOnBATSY': 'tradedOnBATSY',
    'TradedOnBATS': 'tradedOnBATS',
    'TradedOnIEX': 'tradedOnIEX',
    'Tick_Pilot_Indicator': 'tickPilotIndicator',
    'Effective_Date': 'effectiveDate',
    'TradedOnLTSE': 'tradedOnLTSE',
    'TradedOnMEMX': 'tradedOnMEMX',
    'TradedOnMIAX': 'tradedOnMIAX'
}

# Exchange ID to Exchange name mapping
EXNAMES: Dict = {
    "A": "NYSE American", "B": "NASDAQ OMX BX", "C": "NYSE National",
    "D": "FINRA Alternative Display Facility", "I": "International Securities Exchange",
    "J": "Cboe EDGA Exchange", "K": "Cboe EDGX Exchange", "L": "Long-Term Stock Exchange",
    "M": "Chicago Stock Exchange", "N": "New York Stock Exchange", "P": "NYSE Arca",
    "S": "Consolidated Tape System", "T": "NASDAQ Stock Market", "Q": "NASDAQ Stock Exchange",
    "V": "The Investors' Exchange", "W": "Chicago Broad Options Exchange",
    "X": "NASDAQ OMX PSX", "Y": "Cboe BYX Exchange", "Z": "Cboe BZX Exchange"
}

# Table trade: EQY_US_ALL_TRADE_*.csv
TRADE_SCHEMA: Final[pa.Schema] = pa.schema([
    pa.field('Time', pa.string()), # transformed to: pa.time64('ns')
    pa.field('Exchange', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Symbol', pa.string()),
    pa.field('Sale Condition', pa.string()), # transformed to: pa.dictionary(pa.int32(), pa.string())
    pa.field('Trade Volume', pa.float32()),  # NYSE TAQ spec 4.2 allows fractional shares, so we use float32 instead of int32
    pa.field('Trade Price', pa.float32()),
    pa.field('Trade Stop Stock Indicator', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Trade Correction Indicator', pa.uint16()),
    pa.field('Sequence Number', pa.int32()),  # or pa.uint32
    pa.field('Trade Id', pa.uint64()),
    pa.field('Source of Trade', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Trade Reporting Facility', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Participant Timestamp', pa.string()), # transformed to: pa.time64('ns')
    pa.field('Trade Reporting Facility TRF Timestamp', pa.string()), # transformed to: pa.time64('ns')
    pa.field('Trade Through Exempt Indicator', pa.bool_())
])

TRADERENAME: Dict = {
    'Time': 'time',
    'Exchange': 'ex',
    'Symbol': 'sym',
    'Sale Condition': 'cond',
    'Trade Volume': 'size',
    'Trade Price': 'price',
    'Trade Stop Stock Indicator': 'stop',
    'Trade Correction Indicator': 'corr',
    'Sequence Number': 'seq',
    'Trade Id': 'tradeId',
    'Source of Trade': 'source',
    'Trade Reporting Facility': 'tradeReportingFacility',
    'Participant Timestamp': 'participantTimestamp',
    'Trade Reporting Facility TRF Timestamp': 'tradeReportingFacilityTRFTimestamp',
    'Trade Through Exempt Indicator': 'tradeThroughExemptIndicator'
}

# Table quote: splits_us_all_bbo_*[0-9]_*.csv
QUOTE_SCHEMA: Final[pa.Schema] = pa.schema([
    pa.field('Time', pa.string()),  # transformed to pa.time64('ns')
    pa.field('Exchange', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Symbol', pa.string()),
    pa.field('Bid_Price', pa.float32()),
    pa.field('Bid_Size', pa.int32()),  # or pa.uint32
    pa.field('Offer_Price', pa.float32()),
    pa.field('Offer_Size', pa.int32()),  # or pa.uint32
    pa.field('Quote_Condition', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Sequence_Number', pa.int32()),  # or pa.uint32
    pa.field('National_BBO_Ind', pa.dictionary(pa.int32(), pa.string())),
    pa.field('FINRA_BBO_Indicator', pa.string()), # transformed to pa.dictionary(pa.int32(), pa.string())
    pa.field('FINRA_ADF_MPID_Indicator', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Quote_Cancel_Correction', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Source_Of_Quote', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Retail_Interest_Indicator', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Short_Sale_Restriction_Indicator', pa.dictionary(pa.int32(), pa.string())),
    pa.field('LULD_BBO_Indicator', pa.dictionary(pa.int32(), pa.string())),
    pa.field('SIP_Generated_Message_Identifier', pa.dictionary(pa.int32(), pa.string())),
    pa.field('National_BBO_LULD_Indicator', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Participant_Timestamp', pa.string()), # transformed to pa.time64('ns')
    pa.field('FINRA_ADF_Timestamp', pa.string()),   # transformed to pa.time64('ns')
    pa.field('FINRA_ADF_Market_Participant_Quote_Indicator', pa.dictionary(pa.int32(), pa.string())),
    pa.field('Security_Status_Indicator', pa.dictionary(pa.int32(), pa.string()))
])

QUOTERENAME: Dict = {
    'Time': 'time',
    'Exchange': 'ex',
    'Symbol': 'sym',
    'Bid_Price': 'bid',
    'Bid_Size': 'bsize',
    'Offer_Price': 'ask',
    'Offer_Size': 'asize',
    'Quote_Condition': 'cond',
    'Sequence_Number': 'seq',
    'National_BBO_Ind': 'nationalBBOInd',
    'FINRA_BBO_Indicator': 'finraBBOIndicator',
    'FINRA_ADF_MPID_Indicator': 'finraADFMPIDIndicator',
    'Quote_Cancel_Correction': 'corr',
    'Source_Of_Quote': 'source',
    'Retail_Interest_Indicator': 'retailInterestIndicator',
    'Short_Sale_Restriction_Indicator': 'shortSaleRestrictionIndicator',
    'LULD_BBO_Indicator': 'LULDBBOIndicator',
    'SIP_Generated_Message_Identifier': 'SIPGeneratedMessageIdentifier',
    'National_BBO_LULD_Indicator': 'nationalBBOLULDIndicator',
    'Participant_Timestamp': 'participantTimestamp',
    'FINRA_ADF_Timestamp': 'FINRAADFTimestamp',
    'FINRA_ADF_Market_Participant_Quote_Indicator': 'FINRAADFMarketParticipantQuoteIndicator',
    'Security_Status_Indicator': 'securityStatusIndicator'
}
