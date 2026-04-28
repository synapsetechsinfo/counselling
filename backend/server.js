require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const multer = require('multer');

const pool = require('./config/db');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const UPI_VPA = process.env.UPI_VPA || '8411946432@ybl';
const ADMIN_VERIFY_TOKEN = process.env.ADMIN_VERIFY_TOKEN || '';

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function destination(req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function filename(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'].includes(ext) ? ext : '.jpg';
    cb(null, `proof-${Date.now()}-${Math.floor(Math.random() * 100000)}${safeExt}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }
});

function amountInRupees(amountInPaise) {
  return Number(amountInPaise) / 100;
}

function verifyAdminToken(req, res, next) {
  if (!ADMIN_VERIFY_TOKEN) {
    return res.status(503).json({ ok: false, message: 'Admin verification token is not configured' });
  }

  const token = req.headers['x-admin-token'];
  if (!token || token !== ADMIN_VERIFY_TOKEN) {
    return res.status(401).json({ ok: false, message: 'Unauthorized admin action' });
  }

  next();
}

app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN ? process.env.FRONTEND_ORIGIN.split(',') : '*',
    methods: ['GET', 'POST', 'PATCH'],
    credentials: false
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));
app.use('/uploads', express.static(uploadsDir));

const frontendDir = path.join(__dirname, '..', 'public_html');
app.use(express.static(frontendDir));

app.get('/health', (req, res) => {
  res.redirect('/api/health');
});

const PROGRAM_FEES = {
  'Emotional Wellness Certification': 199900,
  'Youth Counseling Intensive': 149900,
  'Corporate Resilience Workshop': 99900,
  'School Mental Health Program': 129900
};

function generateReceiptNumber() {
  return `RCPT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, message: 'API and DB are reachable' });
  } catch (error) {
    res.status(500).json({ ok: false, message: 'Database not reachable', error: error.message });
  }
});

app.get('/api/notices', async (req, res) => {
  try {
    const sql = `
      SELECT id, title, body, priority, starts_at, expires_at, created_at
      FROM notices
      WHERE is_active = 1
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (expires_at IS NULL OR expires_at >= NOW())
      ORDER BY priority DESC, created_at DESC
    `;

    const [rows] = await pool.query(sql);
    res.json({ ok: true, data: rows });
  } catch (error) {
    console.error('GET /api/notices failed:', error);
    res.status(500).json({ ok: false, message: 'Could not fetch notices' });
  }
});

app.post('/api/notices', async (req, res) => {
  try {
    const { title, body, isActive, priority, startsAt, expiresAt } = req.body;
    if (!title || !body) {
      return res.status(400).json({ ok: false, message: 'Title and body are required' });
    }

    const sql = `
      INSERT INTO notices (title, body, is_active, priority, starts_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    const values = [
      title.trim(),
      body.trim(),
      typeof isActive === 'boolean' ? Number(isActive) : 1,
      Number(priority || 0),
      startsAt || null,
      expiresAt || null
    ];

    const [result] = await pool.execute(sql, values);
    return res.status(201).json({ ok: true, noticeId: result.insertId, message: 'Notice created successfully' });
  } catch (error) {
    console.error('POST /api/notices failed:', error);
    return res.status(500).json({ ok: false, message: 'Could not create notice' });
  }
});

app.post('/api/program-requests', async (req, res) => {
  try {
    const {
      organizationName,
      contactPerson,
      email,
      phone,
      requestedProgram,
      participantsEstimate,
      preferredDate,
      message
    } = req.body;

    if (!organizationName || !contactPerson || !email || !phone || !requestedProgram) {
      return res.status(400).json({ ok: false, message: 'Required fields are missing' });
    }

    const sql = `
      INSERT INTO program_requests
      (organization_name, contact_person, email, phone, requested_program, participants_estimate, preferred_date, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      organizationName.trim(),
      contactPerson.trim(),
      email.trim().toLowerCase(),
      phone.trim(),
      requestedProgram.trim(),
      participantsEstimate ? Number(participantsEstimate) : null,
      preferredDate || null,
      message ? message.trim() : null
    ];

    const [result] = await pool.execute(sql, values);

    return res.status(201).json({
      ok: true,
      message: 'Program request submitted successfully',
      requestId: result.insertId
    });
  } catch (error) {
    console.error('POST /api/program-requests failed:', error);
    return res.status(500).json({ ok: false, message: 'Failed to submit request' });
  }
});

app.get('/api/program-requests', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 25), 100);
    const [rows] = await pool.query(
      `
        SELECT id, organization_name, contact_person, email, phone, requested_program,
               participants_estimate, preferred_date, message, status, created_at
        FROM program_requests
        ORDER BY created_at DESC
        LIMIT ?
      `,
      [limit]
    );

    return res.json({ ok: true, data: rows });
  } catch (error) {
    console.error('GET /api/program-requests failed:', error);
    return res.status(500).json({ ok: false, message: 'Failed to fetch program requests' });
  }
});

app.post('/api/payments/create-order', async (req, res) => {
  try {
    const { fullName, email, phone, programName } = req.body;

    if (!fullName || !email || !phone || !programName) {
      return res.status(400).json({ ok: false, message: 'Missing registration fields' });
    }

    const amount = PROGRAM_FEES[programName];
    if (!amount) {
      return res.status(400).json({ ok: false, message: 'Invalid program selected' });
    }

    const sql = `
      INSERT INTO trainees
      (receipt_number, full_name, email, phone, program_name, amount_paid, currency, manual_txn_id, payment_status)
      VALUES (NULL, ?, ?, ?, ?, ?, 'INR', NULL, 'pending')
    `;

    const values = [
      fullName.trim(),
      email.trim().toLowerCase(),
      phone.trim(),
      programName.trim(),
      amountInRupees(amount)
    ];

    const [result] = await pool.execute(sql, values);

    return res.status(201).json({
      ok: true,
      message: 'Registration created. Complete UPI payment and upload proof.',
      traineeId: result.insertId,
      amount: amountInRupees(amount),
      currency: 'INR',
      upiVpa: UPI_VPA
    });
  } catch (error) {
    console.error('POST /api/payments/create-order failed:', error);
    return res.status(500).json({ ok: false, message: 'Unable to create registration' });
  }
});

app.post('/api/payments/verify', async (req, res) => {
  try {
    return res.status(410).json({
      ok: false,
      message: 'Razorpay flow is temporarily disabled. Use UPI proof flow from registration page.'
    });
  } catch (error) {
    console.error('POST /api/payments/verify failed:', error);
    return res.status(500).json({ ok: false, message: 'Payment verification endpoint error' });
  }
});

app.post('/api/payments/upload-proof', upload.single('proofFile'), async (req, res) => {
  try {
    const traineeId = Number(req.body.traineeId);
    const manualTxnId = req.body.manualTxnId ? String(req.body.manualTxnId).trim() : null;

    if (!traineeId) {
      return res.status(400).json({ ok: false, message: 'Invalid trainee id' });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, message: 'Payment proof file is required' });
    }

    const proofPath = `/uploads/${req.file.filename}`;
    const updateSql = `
      UPDATE trainees
      SET payment_proof_path = ?,
          manual_txn_id = ?,
          payment_status = 'proof_submitted'
      WHERE id = ?
    `;

    const [result] = await pool.execute(updateSql, [proofPath, manualTxnId, traineeId]);
    if (!result.affectedRows) {
      return res.status(404).json({ ok: false, message: 'Trainee not found for proof upload' });
    }

    return res.status(200).json({
      ok: true,
      message: 'Payment proof uploaded. Verification pending.',
      traineeId,
      proofPath
    });
  } catch (error) {
    console.error('POST /api/payments/upload-proof failed:', error);
    return res.status(500).json({ ok: false, message: 'Failed to upload payment proof' });
  }
});

app.patch('/api/admin/verify-payment/:id', verifyAdminToken, async (req, res) => {
  try {
    const traineeId = Number(req.params.id);
    const isApproved = Boolean(req.body.isApproved);
    const verifierName = req.body.verifierName ? String(req.body.verifierName).trim() : 'admin';

    if (!traineeId) {
      return res.status(400).json({ ok: false, message: 'Invalid trainee id' });
    }

    const [[existing]] = await pool.execute('SELECT id, receipt_number, payment_status FROM trainees WHERE id = ?', [
      traineeId
    ]);

    if (!existing) {
      return res.status(404).json({ ok: false, message: 'Trainee not found' });
    }

    if (isApproved) {
      const receiptNumber = existing.receipt_number || generateReceiptNumber();
      await pool.execute(
        `
          UPDATE trainees
          SET payment_status = 'paid',
              receipt_number = ?,
              verified_at = NOW(),
              verified_by = ?
          WHERE id = ?
        `,
        [receiptNumber, verifierName, traineeId]
      );

      return res.json({
        ok: true,
        message: 'Payment approved and receipt enabled',
        traineeId,
        receiptNumber
      });
    }

    await pool.execute(
      `
        UPDATE trainees
        SET payment_status = 'rejected',
            verified_at = NOW(),
            verified_by = ?
        WHERE id = ?
      `,
      [verifierName, traineeId]
    );

    return res.json({ ok: true, message: 'Payment marked as rejected', traineeId });
  } catch (error) {
    console.error('PATCH /api/admin/verify-payment/:id failed:', error);
    return res.status(500).json({ ok: false, message: 'Failed to update payment verification status' });
  }
});

app.get('/api/trainees/:id', async (req, res) => {
  try {
    const traineeId = Number(req.params.id);
    if (!traineeId) {
      return res.status(400).json({ ok: false, message: 'Invalid trainee id' });
    }

    const sql = `
      SELECT
        id,
        receipt_number,
        full_name,
        email,
        phone,
        program_name,
        amount_paid,
        currency,
        manual_txn_id,
        payment_proof_path,
        verified_at,
        verified_by,
        payment_status,
        registered_at
      FROM trainees
      WHERE id = ?
      LIMIT 1
    `;

    const [[row]] = await pool.execute(sql, [traineeId]);
    if (!row) {
      return res.status(404).json({ ok: false, message: 'Trainee not found' });
    }

    return res.json({ ok: true, data: row });
  } catch (error) {
    console.error('GET /api/trainees/:id failed:', error);
    return res.status(500).json({ ok: false, message: 'Failed to fetch trainee details' });
  }
});

app.get('/api/trainees', verifyAdminToken, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 25), 100);
    const [rows] = await pool.query(
      `
        SELECT id, receipt_number, full_name, email, phone, program_name, amount_paid,
           currency, manual_txn_id, payment_proof_path, verified_at, verified_by, payment_status, registered_at
        FROM trainees
        ORDER BY registered_at DESC
        LIMIT ?
      `,
      [limit]
    );

    return res.json({ ok: true, data: rows });
  } catch (error) {
    console.error('GET /api/trainees failed:', error);
    return res.status(500).json({ ok: false, message: 'Failed to fetch trainees' });
  }
});

app.use((req, res) => {
  const indexFile = path.join(frontendDir, 'index.html');
  if (fs.existsSync(indexFile)) {
    return res.sendFile(indexFile);
  }
  res.status(404).json({ ok: false, message: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
