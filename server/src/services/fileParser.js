import XLSX from 'xlsx';
import { readFileSync } from 'fs';

/**
 * Parse uploaded files into structured data
 * Supports: Excel (.xlsx, .xls), CSV, JSON, plain text
 */
export function parseFile(filePath, originalName, mimeType) {
  const ext = originalName.split('.').pop().toLowerCase();

  switch (ext) {
    case 'xlsx':
    case 'xls':
      return parseExcel(filePath);
    case 'csv':
      return parseCSV(filePath);
    case 'json':
      return parseJSON(filePath);
    case 'txt':
    case 'md':
      return parseText(filePath);
    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
}

function parseExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheets = {};
  const summaries = {};

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const headers = data.length > 0 ? Object.keys(data[0]) : [];
    
    sheets[sheetName] = {
      headers,
      rows: data,
      rowCount: data.length,
      columnCount: headers.length
    };

    // Generate column summaries for numeric columns
    const colStats = {};
    for (const header of headers) {
      const values = data.map(r => r[header]).filter(v => typeof v === 'number' && !isNaN(v));
      if (values.length > 0) {
        colStats[header] = {
          type: 'numeric',
          min: Math.min(...values),
          max: Math.max(...values),
          avg: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
          sum: +values.reduce((a, b) => a + b, 0).toFixed(2),
          count: values.length
        };
      } else {
        const unique = [...new Set(data.map(r => r[header]).filter(Boolean))];
        colStats[header] = {
          type: 'text',
          uniqueValues: unique.length,
          sampleValues: unique.slice(0, 10)
        };
      }
    }
    summaries[sheetName] = colStats;
  }

  return {
    type: 'spreadsheet',
    filename: filePath.split(/[/\\]/).pop(),
    sheetCount: workbook.SheetNames.length,
    sheetNames: workbook.SheetNames,
    sheets,
    summaries,
    totalRows: Object.values(sheets).reduce((sum, s) => sum + s.rowCount, 0)
  };
}

function parseCSV(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const workbook = XLSX.read(content, { type: 'string' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const headers = data.length > 0 ? Object.keys(data[0]) : [];

  const colStats = {};
  for (const header of headers) {
    const values = data.map(r => r[header]).filter(v => typeof v === 'number' && !isNaN(v));
    if (values.length > 0) {
      colStats[header] = {
        type: 'numeric',
        min: Math.min(...values),
        max: Math.max(...values),
        avg: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
        sum: +values.reduce((a, b) => a + b, 0).toFixed(2),
        count: values.length
      };
    } else {
      const unique = [...new Set(data.map(r => r[header]).filter(Boolean))];
      colStats[header] = {
        type: 'text',
        uniqueValues: unique.length,
        sampleValues: unique.slice(0, 10)
      };
    }
  }

  return {
    type: 'csv',
    headers,
    rows: data,
    rowCount: data.length,
    columnCount: headers.length,
    summaries: { 'Sheet1': colStats }
  };
}

function parseJSON(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);

  if (Array.isArray(data)) {
    const headers = data.length > 0 ? Object.keys(data[0]) : [];
    return {
      type: 'json-array',
      headers,
      rows: data,
      rowCount: data.length,
      columnCount: headers.length
    };
  }

  return {
    type: 'json-object',
    data,
    keys: Object.keys(data),
    preview: JSON.stringify(data, null, 2).slice(0, 5000)
  };
}

function parseText(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  return {
    type: 'text',
    content: content.slice(0, 50000),
    length: content.length,
    lineCount: content.split('\n').length
  };
}

/**
 * Create a concise data summary for AI consumption
 * Reduces token usage by summarizing large datasets
 */
export function createDataSummary(parsedData, maxRows = 50) {
  const summary = {
    fileType: parsedData.type,
    overview: {}
  };

  if (parsedData.type === 'spreadsheet') {
    summary.overview = {
      sheets: parsedData.sheetCount,
      totalRows: parsedData.totalRows,
      sheetNames: parsedData.sheetNames
    };
    summary.data = {};
    for (const [name, sheet] of Object.entries(parsedData.sheets)) {
      summary.data[name] = {
        headers: sheet.headers,
        rowCount: sheet.rowCount,
        sampleRows: sheet.rows.slice(0, maxRows),
        statistics: parsedData.summaries[name]
      };
    }
  } else if (parsedData.type === 'csv' || parsedData.type === 'json-array') {
    summary.overview = {
      rows: parsedData.rowCount,
      columns: parsedData.columnCount,
      headers: parsedData.headers
    };
    summary.data = {
      sampleRows: parsedData.rows.slice(0, maxRows),
      statistics: parsedData.summaries?.['Sheet1'] || {}
    };
  } else if (parsedData.type === 'json-object') {
    summary.overview = { keys: parsedData.keys };
    summary.data = parsedData.data;
  } else {
    summary.data = { content: parsedData.content?.slice(0, 10000) };
  }

  return summary;
}
