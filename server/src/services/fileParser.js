import XLSX from 'xlsx';
import { readFileSync } from 'fs';

// Truncation / slicing limits (chars unless noted) for parsed-file payloads.
const MAX_HTML_CHARS = 100000;    // raw HTML kept on parse
const MAX_TEXT_CHARS = 50000;     // plain text / extracted HTML text kept on parse
const JSON_PREVIEW_CHARS = 5000;  // pretty-printed JSON-object preview
const SUMMARY_HTML_CHARS = 15000; // HTML content kept in the AI data summary
const SUMMARY_TEXT_CHARS = 10000; // text content kept in the AI data summary
const SAMPLE_VALUE_CAP = 10;      // distinct sample values kept per text column
const STAT_DECIMALS = 2;          // decimal places for avg/sum column stats

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
    case 'html':
    case 'htm':
      return parseHTML(filePath);
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
          avg: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(STAT_DECIMALS),
          sum: +values.reduce((a, b) => a + b, 0).toFixed(STAT_DECIMALS),
          count: values.length
        };
      } else {
        const unique = [...new Set(data.map(r => r[header]).filter(Boolean))];
        colStats[header] = {
          type: 'text',
          uniqueValues: unique.length,
          sampleValues: unique.slice(0, SAMPLE_VALUE_CAP)
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
        avg: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(STAT_DECIMALS),
        sum: +values.reduce((a, b) => a + b, 0).toFixed(STAT_DECIMALS),
        count: values.length
      };
    } else {
      const unique = [...new Set(data.map(r => r[header]).filter(Boolean))];
      colStats[header] = {
        type: 'text',
        uniqueValues: unique.length,
        sampleValues: unique.slice(0, SAMPLE_VALUE_CAP)
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
    preview: JSON.stringify(data, null, 2).slice(0, JSON_PREVIEW_CHARS)
  };
}

function parseHTML(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  // Strip HTML tags for plain text extraction
  const textContent = content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  // Extract title from <title> or first <h1>
  const titleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

  return {
    type: 'html',
    content: content.slice(0, MAX_HTML_CHARS),
    textContent: textContent.slice(0, MAX_TEXT_CHARS),
    title,
    length: content.length,
    lineCount: content.split('\n').length
  };
}

function parseText(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  return {
    type: 'text',
    content: content.slice(0, MAX_TEXT_CHARS),
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
  } else if (parsedData.type === 'html') {
    summary.overview = { title: parsedData.title, length: parsedData.length, lineCount: parsedData.lineCount };
    summary.data = {
      htmlContent: parsedData.content?.slice(0, SUMMARY_HTML_CHARS),
      textContent: parsedData.textContent?.slice(0, SUMMARY_TEXT_CHARS)
    };
  } else {
    summary.data = { content: parsedData.content?.slice(0, SUMMARY_TEXT_CHARS) };
  }

  return summary;
}
