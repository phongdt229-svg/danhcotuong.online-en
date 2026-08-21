/*
 * paypal.service.js — Lớp gọi PayPal REST API (Orders v2).
 *
 * Chỉ lo phần giao tiếp với PayPal; việc cộng điểm nằm ở points.service.js.
 * Dùng fetch có sẵn của Node 18+ nên không cần thêm thư viện.
 */
require('dotenv').config();

const LIVE_BASE = 'https://api-m.paypal.com';
const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';

function isLive() {
  return String(process.env.PAYPAL_MODE || 'sandbox').toLowerCase() === 'live';
}

function apiBase() {
  return isLive() ? LIVE_BASE : SANDBOX_BASE;
}

function clientId() {
  return process.env.PAYPAL_CLIENT_ID || '';
}

function isConfigured() {
  return Boolean(clientId() && process.env.PAYPAL_CLIENT_SECRET);
}

/* ---------- Access token (cache lại tới khi gần hết hạn) ---------- */
let tokenCache = { value: null, expiresAt: 0 };

async function accessToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  if (!isConfigured()) throw new Error('PayPal chưa được cấu hình (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)');

  const basic = Buffer.from(`${clientId()}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.access_token) {
    throw new Error(`Không lấy được access token PayPal (HTTP ${res.status})`);
  }
  // Trừ hao 60s để không dùng token vừa hết hạn giữa chừng.
  tokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(0, (Number(data.expires_in) || 0) - 60) * 1000,
  };
  return tokenCache.value;
}

async function callApi(method, path, { body, requestId } = {}) {
  const token = await accessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  // PayPal-Request-Id: gọi lại cùng id sẽ không tạo/thu tiền thêm lần nữa.
  if (requestId) headers['PayPal-Request-Id'] = requestId;

  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

/* ---------- Orders v2 ---------- */

// Tạo đơn. Số tiền do MÁY CHỦ quyết định, không nhận từ client.
async function createOrder({ amountUsd, referenceId, description }) {
  const value = Number(amountUsd).toFixed(2);
  const { ok, status, data } = await callApi('POST', '/v2/checkout/orders', {
    body: {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: String(referenceId),
          description: description,
          amount: { currency_code: 'USD', value },
        },
      ],
      application_context: {
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
      },
    },
  });
  if (!ok || !data || !data.id) {
    throw new Error(`Tạo đơn PayPal thất bại (HTTP ${status}): ${describeError(data)}`);
  }
  return data;
}

async function captureOrder(orderId) {
  return callApi('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    body: {},
    requestId: `capture-${orderId}`,
  });
}

async function getOrder(orderId) {
  return callApi('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

// Rút gọn lỗi PayPal thành một dòng để ghi log / lưu DB.
function describeError(data) {
  if (!data) return 'không có phản hồi';
  const detail = Array.isArray(data.details) && data.details[0];
  return [data.name, detail && detail.issue, data.message].filter(Boolean).join(' | ') || 'lỗi không rõ';
}

// Lấy capture đã hoàn tất (kèm số tiền thật) từ payload capture hoặc order.
function extractCompletedCapture(order) {
  const unit = order && Array.isArray(order.purchase_units) && order.purchase_units[0];
  const captures = unit && unit.payments && unit.payments.captures;
  if (!Array.isArray(captures)) return null;
  return captures.find((c) => c && c.status === 'COMPLETED') || null;
}

module.exports = {
  isConfigured,
  isLive,
  clientId,
  createOrder,
  captureOrder,
  getOrder,
  describeError,
  extractCompletedCapture,
};
