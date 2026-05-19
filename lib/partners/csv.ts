import Papa from 'papaparse';

export interface PartnerCsvRow {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  roleTitle: string | null;
  weight: number;
  careerTargetHints: string[];
}

export interface PartnerCsvError {
  row: number; // 1-indexed, header row = 1, first data row = 2
  message: string;
}

export interface PartnerCsvResult {
  rows: PartnerCsvRow[];
  errors: PartnerCsvError[];
}

const REQUIRED_HEADERS = ['email', 'firstName', 'lastName', 'company', 'roleTitle', 'weight', 'careerTargetHints'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parsePartnersCsv(input: string): PartnerCsvResult {
  // Strip BOM if present.
  const clean = input.replace(/^﻿/, '');
  const parsed = Papa.parse<string[]>(clean, { skipEmptyLines: true });
  const errors: PartnerCsvError[] = [];

  if (parsed.errors.length > 0) {
    for (const e of parsed.errors) {
      errors.push({ row: (e.row ?? 0) + 1, message: e.message });
    }
  }

  const allRows = parsed.data;
  if (allRows.length === 0) {
    return { rows: [], errors: [{ row: 0, message: 'CSV is empty' }] };
  }

  const headers = allRows[0]!.map(h => h.trim());
  // Missing required headers
  for (const required of REQUIRED_HEADERS) {
    if (!headers.includes(required)) {
      errors.push({ row: 1, message: `Missing header: ${required}` });
    }
  }
  // Unknown headers
  for (const h of headers) {
    if (!(REQUIRED_HEADERS as readonly string[]).includes(h)) {
      errors.push({ row: 1, message: `Unknown header: ${h}` });
    }
  }
  if (errors.some(e => e.row === 1)) {
    return { rows: [], errors };
  }

  const index = (name: string) => headers.indexOf(name);
  const rows: PartnerCsvRow[] = [];

  for (let i = 1; i < allRows.length; i++) {
    const raw = allRows[i]!.map(c => (c ?? '').trim());
    const rowNum = i + 1;
    const email = raw[index('email')];
    if (!email) {
      errors.push({ row: rowNum, message: 'email is required' });
      continue;
    }
    if (!EMAIL_RE.test(email)) {
      errors.push({ row: rowNum, message: `email "${email}" is invalid` });
      continue;
    }
    const firstName = raw[index('firstName')];
    const lastName = raw[index('lastName')];
    const company = raw[index('company')];
    if (!firstName || !lastName || !company) {
      errors.push({ row: rowNum, message: 'firstName, lastName, and company are required' });
      continue;
    }
    const roleTitleRaw = raw[index('roleTitle')];
    const weightRaw = raw[index('weight')];
    const hintsRaw = raw[index('careerTargetHints')];
    let weight = 1;
    if (weightRaw) {
      const n = Number.parseInt(weightRaw, 10);
      if (Number.isNaN(n) || n < 0 || n > 10) {
        errors.push({ row: rowNum, message: `weight "${weightRaw}" must be an integer 0-10` });
        continue;
      }
      weight = n;
    }
    const careerTargetHints = hintsRaw
      ? hintsRaw.split('|').map(s => s.trim()).filter(Boolean)
      : [];

    rows.push({
      email,
      firstName,
      lastName,
      company,
      roleTitle: roleTitleRaw || null,
      weight,
      careerTargetHints,
    });
  }

  return { rows, errors };
}
