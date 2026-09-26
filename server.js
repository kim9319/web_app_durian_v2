const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function extractOptions(rawOptions) {
  const options = [];
  if (!Array.isArray(rawOptions)) return options;
  rawOptions.forEach((opt) => {
    if (Array.isArray(opt) && opt.length > 0) {
      const val = (opt[0] !== null && opt[0] !== undefined) ? String(opt[0]) : '';
      options.push({ value: val, label: val });
    } else if (typeof opt === 'string' || typeof opt === 'number') {
      const val = String(opt);
      options.push({ value: val, label: val });
    }
  });
  return options;
}

function parseFromLoadData(formData) {
  const fields = [];
  try {
    const questions = formData[1][1];
    if (!Array.isArray(questions)) return fields;

    const formTitle = (formData[1] && (formData[1][8] || formData[1][0])) || '';
    let sectionCount = 1;
    let currentSection = formTitle ? `Section 1: ${formTitle}` : 'Section 1';

    questions.forEach((q) => {
      if (!Array.isArray(q)) return;

      const label = (q[1] || '').trim();
      const questionType = q[3];
      const subEntries = q[4] || [];

      if (questionType === 6 || questionType === 11 || (subEntries.length === 0 && label)) {
        sectionCount++;
        currentSection = label ? `Section ${sectionCount}: ${label}` : `Section ${sectionCount}`;
        return;
      }

      if (subEntries.length === 0) return;

      const rawOptions = subEntries[0][1];

      switch (questionType) {
        case 0:
          fields.push({ name: 'entry.' + subEntries[0][0], label, type: 'text', questionType, section: currentSection });
          break;
        case 1:
          fields.push({ name: 'entry.' + subEntries[0][0], label, type: 'textarea', questionType, section: currentSection });
          break;
        case 2:
          fields.push({
            name: 'entry.' + subEntries[0][0],
            label,
            type: 'radio',
            questionType,
            options: extractOptions(rawOptions),
            section: currentSection
          });
          break;
        case 3:
          fields.push({
            name: 'entry.' + subEntries[0][0],
            label,
            type: 'select',
            questionType,
            options: extractOptions(rawOptions),
            section: currentSection
          });
          break;
        case 4:
          fields.push({
            name: 'entry.' + subEntries[0][0],
            label,
            type: 'checkbox',
            questionType,
            options: extractOptions(rawOptions),
            section: currentSection
          });
          break;
        case 5:
        case 18: {
          const options = extractOptions(rawOptions);
          if (questionType === 5) {
            const labelsArray = Array.isArray(subEntries[0][3]) ? subEntries[0][3] : (q[5] || []);
            const lowLabel = labelsArray[0] || '';
            const highLabel = labelsArray[1] || '';
            if (options.length > 0 && lowLabel) options[0].label += ' (' + lowLabel + ')';
            if (options.length > 0 && highLabel) options[options.length - 1].label += ' (' + highLabel + ')';
          }
          fields.push({ name: 'entry.' + subEntries[0][0], label, type: 'linear', questionType, options, section: currentSection });
          break;
        }
        case 7:
        case 8: {
          const colOptions = extractOptions(subEntries[0][1]);
          subEntries.forEach((se, idx) => {
            const rowLabel = se[3] ? se[3][0] : `Row ${idx + 1}`;
            fields.push({
              name: 'entry.' + se[0],
              label: label + ' [' + rowLabel + ']',
              type: questionType === 7 ? 'radio' : 'checkbox',
              questionType,
              options: colOptions,
              rowIndex: idx,
              isGrid: true,
              section: currentSection
            });
          });
          break;
        }
        case 9:
          fields.push({ name: 'entry.' + subEntries[0][0], label, type: 'date', questionType, section: currentSection });
          break;
        case 10:
          fields.push({ name: 'entry.' + subEntries[0][0], label, type: 'time', questionType, section: currentSection });
          break;
        default:
          fields.push({ name: 'entry.' + subEntries[0][0], label, type: 'text', questionType, section: currentSection });
      }
    });
  } catch (e) {
    console.error('Error parsing FB_PUBLIC_LOAD_DATA_:', e);
  }
  return fields;
}

app.post('/api/fetch-form', async (req, res) => {
  const { url } = req.body;
  if (!url || !url.includes('docs.google.com/forms')) {
    return res.status(400).json({ success: false, error: 'Please provide a valid Google Form URL.' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    if (!response.ok) {
      return res.status( response.status ).json({ success: false, error: `Failed to fetch form URL (HTTP ${response.status})` });
    }

    const html = await response.text();

    // Extract FB_PUBLIC_LOAD_DATA_
    const startIdx = html.indexOf('FB_PUBLIC_LOAD_DATA_');
    if (startIdx === -1) {
      return res.status(400).json({ success: false, error: 'Could not find form data in page HTML.' });
    }

    const arrayStart = html.indexOf('[', startIdx);
    const arrayEnd = html.lastIndexOf(']');
    if (arrayStart === -1 || arrayEnd === -1) {
      return res.status(400).json({ success: false, error: 'Could not parse form data structure.' });
    }

    const jsonStr = html.substring(arrayStart, arrayEnd + 1);
    const formData = JSON.parse(jsonStr);

    const formTitle = (formData[1] && formData[1][8]) || (formData[1] && formData[1][0]) || 'Google Form';
    const fields = parseFromLoadData(formData);

    return res.json({
      success: true,
      title: formTitle,
      fields
    });
  } catch (err) {
    console.error('Error fetching form:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Configurator Web Server running at http://localhost:${PORT}`);
});
