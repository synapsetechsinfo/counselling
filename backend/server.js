require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const Razorpay = require('razorpay');

const pool = require('./config/db');

const app = express();
const PORT = Number(process.env.PORT || 5000);

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.warn('Razorpay keys are missing. Payment endpoints will fail until env vars are configured.');
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN ? process.env.FRONTEND_ORIGIN.split(',') : '*',
    methods: ['GET', 'POST'],
    credentials: false
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

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

    const order = await razorpay.orders.create({
      amount,
      currency: 'INR',
      receipt: `order_${Date.now()}`,
      payment_capture: 1,
      notes: {
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        programName: programName.trim()
      }
    });

    return res.status(201).json({
      ok: true,
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      registration: {
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        programName: programName.trim()
      }
    });
  } catch (error) {
    console.error('POST /api/payments/create-order failed:', error);
    return res.status(500).json({ ok: false, message: 'Unable to create payment order' });
  }
});

app.post('/api/payments/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ ok: false, message: 'Missing payment verification fields' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ ok: false, message: 'Invalid payment signature' });
    }

    const [[existing]] = await pool.query('SELECT id, receipt_number FROM trainees WHERE razorpay_order_id = ?', [
      razorpay_order_id
    ]);

    if (existing) {
      return res.status(200).json({
        ok: true,
        message: 'Payment already verified',
        traineeId: existing.id,
        receiptNumber: existing.receipt_number
      });
    }

    const orderData = await razorpay.orders.fetch(razorpay_order_id);
    const notes = orderData.notes || {};

    const fullName = notes.fullName || 'Unknown';
    const email = (notes.email || '').toLowerCase();
    const phone = notes.phone || '';
    const programName = notes.programName || 'Unspecified Program';
    const amountPaid = Number(orderData.amount) / 100;
    const currency = orderData.currency || 'INR';
    const receiptNumber = generateReceiptNumber();

    const insertSql = `
      INSERT INTO trainees
      (receipt_number, full_name, email, phone, program_name, amount_paid, currency, razorpay_order_id, razorpay_payment_id, razorpay_signature, payment_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid')
    `;

    const values = [
      receiptNumber,
      fullName,
      email,
      phone,
      programName,
      amountPaid,
      currency,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    ];

    const [result] = await pool.execute(insertSql, values);

    return res.status(201).json({
      ok: true,
      message: 'Payment verified and trainee registered',
      traineeId: result.insertId,
      receiptNumber,
      transactionId: razorpay_payment_id
    });
  } catch (error) {
    console.error('POST /api/payments/verify failed:', error);
    return res.status(500).json({ ok: false, message: 'Payment verification failed' });
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
        razorpay_payment_id,
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

app.get('/api/trainees', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 25), 100);
    const [rows] = await pool.query(
      `
        SELECT id, receipt_number, full_name, email, phone, program_name, amount_paid,
               currency, razorpay_payment_id, payment_status, registered_at
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
  res.status(404).json({ ok: false, message: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
