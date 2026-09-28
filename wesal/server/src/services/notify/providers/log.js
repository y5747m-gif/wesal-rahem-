// مزوّد تطويري: يكتب الرسالة في السجل فقط. استبدله بـ Twilio/Unifonic... إلخ.
export const logProvider = {
  name: 'log',
  async send({ to, channel, message }) {
    console.log(`📨 [${channel}] إلى ${to}: ${message}`);
  },
};
