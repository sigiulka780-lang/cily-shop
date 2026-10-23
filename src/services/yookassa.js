const crypto = require('crypto');
const axios = require('axios');

const SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;
const WEBHOOK_SECRET = process.env.YOOKASSA_WEBHOOK_SECRET;

const API_BASE = 'https://api.yookassa.ru/v3';

function getAuthHeader() {
  return 'Basic ' + Buffer.from(`${SHOP_ID}:${SECRET_KEY}`).toString('base64');
}

async function createPayment({ amount, description, email, licenseKey, paymentId, returnUrl }) {
  const idempotenceKey = paymentId;
  
  const payload = {
    amount: {
      value: amount.toFixed(2),
      currency: 'RUB',
    },
    capture: true,
    confirmation: {
      type: 'redirect',
      return_url: returnUrl,
    },
    description,
    metadata: {
      license_key: licenseKey,
      payment_id: paymentId,
      email,
    },
    receipt: {
      customer: { email },
      items: [{
        description,
        quantity: '1.00',
        amount: { value: amount.toFixed(2), currency: 'RUB' },
        vat_code: 1,
        payment_mode: 'full_payment',
        payment_subject: 'service',
      }],
    },
  };
  
  const response = await axios.post(`${API_BASE}/payments`, payload, {
    headers: {
      'Authorization': getAuthHeader(),
      'Idempotence-Key': idempotenceKey,
      'Content-Type': 'application/json',
    },
  });
  
  return {
    id: response.data.id,
    confirmationUrl: response.data.confirmation?.confirmation_url,
    status: response.data.status,
  };
}

async function getPayment(paymentId) {
  try {
    const response = await axios.get(`${API_BASE}/payments/${paymentId}`, {
      headers: { 'Authorization': getAuthHeader() },
    });
    return response.data;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

function verifyWebhook(req) {
  if (!WEBHOOK_SECRET) {
    console.warn('YOOKASSA_WEBHOOK_SECRET not set, skipping verification');
    return true;
  }
  
  const signature = req.headers['yookassa-signature'] || req.headers['x-yookassa-signature'];
  if (!signature) return false;
  
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(req.body)
    .digest('base64');
  
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

module.exports = {
  createPayment,
  getPayment,
  verifyWebhook,
};