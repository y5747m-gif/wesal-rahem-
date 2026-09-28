// مزوّد Webhook عام: يرسل JSON إلى أي خدمة رسائل خارجية (Twilio proxy، n8n، Zapier...).
// اضبط SMS_PROVIDER=webhook و SMS_WEBHOOK_URL في متغيرات البيئة.
import { config } from '../../../config.js';

export const webhookProvider = {
  name: 'webhook',
  async send({ to, channel, message }) {
    if (!config.smsWebhookUrl) throw new Error('SMS_WEBHOOK_URL غير مضبوط');
    const res = await fetch(config.smsWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, channel, message, app: 'wesal' }),
    });
    if (!res.ok) throw new Error(`Webhook HTTP ${res.status}`);
  },
};
