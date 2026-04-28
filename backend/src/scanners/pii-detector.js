/**
 * DPDPA (Digital Personal Data Protection Act, India) PII Detector
 * Classifies columns and sample data into PII categories
 */

const PII_CATEGORIES = {
  PERSONAL_IDENTITY: {
    label: 'Personal Identity',
    color: '#E74C3C',
    icon: '👤',
    description: 'Name, father/mother name, date of birth, age, gender',
    dpdpa_section: 'Section 2(t) - Personal Data',
  },
  CONTACT_INFO: {
    label: 'Contact Information',
    color: '#E67E22',
    icon: '📞',
    description: 'Email, phone, mobile, address, pincode',
    dpdpa_section: 'Section 2(t) - Personal Data',
  },
  GOVERNMENT_ID: {
    label: 'Government ID',
    color: '#8E44AD',
    icon: '🪪',
    description: 'Aadhaar, PAN, Passport, Voter ID, Driving License',
    dpdpa_section: 'Section 2(m) - Sensitive Personal Data',
  },
  FINANCIAL: {
    label: 'Financial Data',
    color: '#27AE60',
    icon: '💰',
    description: 'Bank account, IFSC, credit card, salary, income, UPI',
    dpdpa_section: 'Section 2(m) - Sensitive Personal Data',
  },
  HEALTH: {
    label: 'Health & Medical',
    color: '#16A085',
    icon: '🏥',
    description: 'Blood group, medical records, diagnosis, prescription',
    dpdpa_section: 'Section 2(m) - Sensitive Personal Data',
  },
  BIOMETRIC: {
    label: 'Biometric Data',
    color: '#C0392B',
    icon: '🔬',
    description: 'Fingerprint, face ID, iris scan, retina',
    dpdpa_section: 'Section 2(m) - Sensitive Personal Data',
  },
  DIGITAL_IDENTITY: {
    label: 'Digital Identity',
    color: '#2980B9',
    icon: '🌐',
    description: 'IP address, device ID, cookies, GPS location',
    dpdpa_section: 'Section 2(t) - Personal Data',
  },
  SENSITIVE_PERSONAL: {
    label: 'Sensitive Personal',
    color: '#D35400',
    icon: '⚠️',
    description: 'Religion, caste, political views, sexual orientation',
    dpdpa_section: 'Section 2(m) - Sensitive Personal Data',
  },
};

// Column name patterns → PII category
const COLUMN_PATTERNS = [
  // Personal Identity
  { pattern: /\b(full_?name|first_?name|last_?name|middle_?name|sur_?name|given_?name|father_?name|mother_?name|guardian_?name|person_?name)\b/i, category: 'PERSONAL_IDENTITY', confidence: 'HIGH' },
  { pattern: /\b(name)\b/i, category: 'PERSONAL_IDENTITY', confidence: 'MEDIUM' },
  { pattern: /\b(dob|date_?of_?birth|birth_?date|birthdate|age|gender|sex|salutation|title|marital_?status)\b/i, category: 'PERSONAL_IDENTITY', confidence: 'HIGH' },

  // Contact Info
  { pattern: /\b(email|e_?mail|email_?id|email_?address)\b/i, category: 'CONTACT_INFO', confidence: 'HIGH' },
  { pattern: /\b(phone|mobile|cell|telephone|contact_?no|contact_?number|phone_?no|mob_?no|whatsapp)\b/i, category: 'CONTACT_INFO', confidence: 'HIGH' },
  { pattern: /\b(address|addr|street|city|state|district|locality|landmark|pincode|pin_?code|zip|zipcode|postal)\b/i, category: 'CONTACT_INFO', confidence: 'HIGH' },

  // Government IDs
  { pattern: /\b(aadhaar|aadhar|uid|uid_?number|aadhaar_?no|aadhaar_?number)\b/i, category: 'GOVERNMENT_ID', confidence: 'HIGH' },
  { pattern: /\b(pan|pan_?no|pan_?number|pan_?card)\b/i, category: 'GOVERNMENT_ID', confidence: 'HIGH' },
  { pattern: /\b(passport|passport_?no|passport_?number)\b/i, category: 'GOVERNMENT_ID', confidence: 'HIGH' },
  { pattern: /\b(voter_?id|voter_?card|epic_?no|election_?id)\b/i, category: 'GOVERNMENT_ID', confidence: 'HIGH' },
  { pattern: /\b(driving_?license|dl_?no|license_?no|driving_?licence)\b/i, category: 'GOVERNMENT_ID', confidence: 'HIGH' },
  { pattern: /\b(national_?id|govt_?id|government_?id|citizen_?id|ssn|social_?security)\b/i, category: 'GOVERNMENT_ID', confidence: 'HIGH' },

  // Financial
  { pattern: /\b(bank_?account|account_?no|account_?number|savings_?account|current_?account)\b/i, category: 'FINANCIAL', confidence: 'HIGH' },
  { pattern: /\b(ifsc|ifsc_?code|routing_?number|swift_?code|micr)\b/i, category: 'FINANCIAL', confidence: 'HIGH' },
  { pattern: /\b(credit_?card|debit_?card|card_?no|card_?number|cvv|expiry)\b/i, category: 'FINANCIAL', confidence: 'HIGH' },
  { pattern: /\b(salary|income|wage|ctc|pay|remuneration|compensation|tax_?id|gstin|gst_?no)\b/i, category: 'FINANCIAL', confidence: 'MEDIUM' },
  { pattern: /\b(upi|vpa|upi_?id|payment_?id|transaction_?id)\b/i, category: 'FINANCIAL', confidence: 'MEDIUM' },

  // Health
  { pattern: /\b(blood_?group|blood_?type)\b/i, category: 'HEALTH', confidence: 'HIGH' },
  { pattern: /\b(medical|health|diagnosis|disease|prescription|medicine|treatment|allergy|disability|weight|height|bmi)\b/i, category: 'HEALTH', confidence: 'MEDIUM' },
  { pattern: /\b(insurance_?no|health_?id|abha|ayushman)\b/i, category: 'HEALTH', confidence: 'HIGH' },

  // Biometric
  { pattern: /\b(fingerprint|biometric|face_?id|iris|retina|voice_?print|facial)\b/i, category: 'BIOMETRIC', confidence: 'HIGH' },

  // Digital Identity
  { pattern: /\b(ip_?address|ip_?addr|ipv4|ipv6)\b/i, category: 'DIGITAL_IDENTITY', confidence: 'HIGH' },
  { pattern: /\b(device_?id|device_?token|mac_?address|imei|udid|android_?id)\b/i, category: 'DIGITAL_IDENTITY', confidence: 'HIGH' },
  { pattern: /\b(location|latitude|longitude|lat|lng|gps|geo|coordinates)\b/i, category: 'DIGITAL_IDENTITY', confidence: 'MEDIUM' },
  { pattern: /\b(cookie|session_?id|token|auth_?token|refresh_?token)\b/i, category: 'DIGITAL_IDENTITY', confidence: 'MEDIUM' },

  // Sensitive Personal
  { pattern: /\b(religion|religious|faith|caste|sub_?caste|community)\b/i, category: 'SENSITIVE_PERSONAL', confidence: 'HIGH' },
  { pattern: /\b(political|party_?affiliation|political_?view)\b/i, category: 'SENSITIVE_PERSONAL', confidence: 'HIGH' },
  { pattern: /\b(sexual_?orientation|gender_?identity|lgbtq)\b/i, category: 'SENSITIVE_PERSONAL', confidence: 'HIGH' },
  { pattern: /\b(ethnicity|race|nationality|tribe)\b/i, category: 'SENSITIVE_PERSONAL', confidence: 'HIGH' },
];

// Data value patterns (regex on sample data)
const DATA_PATTERNS = [
  { pattern: /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/, category: 'CONTACT_INFO', type: 'Email address' },
  { pattern: /^(\+91|91|0)?[6-9]\d{9}$/, category: 'CONTACT_INFO', type: 'Indian mobile number' },
  { pattern: /^\d{4}\s?\d{4}\s?\d{4}$/, category: 'GOVERNMENT_ID', type: 'Aadhaar number' },
  { pattern: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, category: 'GOVERNMENT_ID', type: 'PAN card' },
  { pattern: /^[A-Z]{1}[0-9]{7}$/, category: 'GOVERNMENT_ID', type: 'Passport number' },
  { pattern: /^\d{4}\s?\d{6}\s?\d{5}\s?\d{1}$/, category: 'FINANCIAL', type: 'Credit card number' },
  { pattern: /^[A-Z]{4}0[A-Z0-9]{6}$/, category: 'FINANCIAL', type: 'IFSC code' },
  { pattern: /^(\d{1,3}\.){3}\d{1,3}$/, category: 'DIGITAL_IDENTITY', type: 'IPv4 address' },
  { pattern: /^(A|B|AB|O)[+-]$/i, category: 'HEALTH', type: 'Blood group' },
];

function detectColumnPII(columnName) {
  const results = [];
  for (const rule of COLUMN_PATTERNS) {
    if (rule.pattern.test(columnName)) {
      results.push({
        category: rule.category,
        confidence: rule.confidence,
        matchedBy: 'column_name',
        categoryInfo: PII_CATEGORIES[rule.category],
      });
      break; // Take first match
    }
  }
  return results;
}

function detectDataPII(sampleValues) {
  if (!sampleValues || sampleValues.length === 0) return [];
  const categoryHits = {};
  for (const value of sampleValues) {
    if (!value) continue;
    const strVal = String(value).trim();
    for (const rule of DATA_PATTERNS) {
      if (rule.pattern.test(strVal)) {
        if (!categoryHits[rule.category]) {
          categoryHits[rule.category] = { count: 0, types: new Set() };
        }
        categoryHits[rule.category].count++;
        categoryHits[rule.category].types.add(rule.type);
      }
    }
  }
  return Object.entries(categoryHits).map(([category, info]) => ({
    category,
    confidence: info.count >= 3 ? 'HIGH' : info.count >= 1 ? 'MEDIUM' : 'LOW',
    matchedBy: 'data_pattern',
    matchedTypes: [...info.types],
    categoryInfo: PII_CATEGORIES[category],
  }));
}

function classifyColumn(columnName, sampleValues) {
  const nameMatches = detectColumnPII(columnName);
  const dataMatches = detectDataPII(sampleValues);

  // Merge — prefer HIGH confidence, deduplicate by category
  const merged = new Map();
  for (const m of [...nameMatches, ...dataMatches]) {
    const existing = merged.get(m.category);
    if (!existing || (m.confidence === 'HIGH' && existing.confidence !== 'HIGH')) {
      merged.set(m.category, m);
    }
  }
  return [...merged.values()];
}

module.exports = { classifyColumn, PII_CATEGORIES };
