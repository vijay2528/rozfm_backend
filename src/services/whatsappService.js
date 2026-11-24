/**
 * WhatsApp Cloud API Service
 * Handles sending OTP and authentication messages via Meta WhatsApp Business Cloud API
 */

function formatPhoneNumber(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');

  // If 11 digits starting with 0 (e.g. 09876543210 in India), remove 0 and add 91
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = '91' + digits.slice(1);
  }
  // If standard 10-digit Indian mobile number, prepend 91
  else if (digits.length === 10) {
    digits = '91' + digits;
  }

  return digits;
}

class WhatsAppService {
  /**
   * Send OTP via WhatsApp Template Message
   * @param {string} phone - Recipient phone number
   * @param {string|number} otp - 6-digit OTP code
   * @returns {Promise<{success: boolean, messageId?: string, error?: any}>}
   */
  static async sendOtp(phone, otp) {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.PHONE_NUMBER_ID;
    const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'send_otp';
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v21.0';

    const formattedTo = formatPhoneNumber(phone);
    const otpCode = String(otp).trim();

    if (!token || !phoneNumberId) {
      console.warn('[WhatsAppService] Missing WHATSAPP_ACCESS_TOKEN or PHONE_NUMBER_ID in environment variables.');
      return {
        success: false,
        error: 'WhatsApp credentials not configured on server.',
        unconfigured: true,
      };
    }

    if (!formattedTo) {
      console.error('[WhatsAppService] Invalid recipient phone number:', phone);
      return {
        success: false,
        error: 'Invalid phone number.',
      };
    }

    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

    // Template payload for "send_otp" AUTHENTICATION template with COPY_CODE button
    const payloadWithButton = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedTo,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: otpCode,
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: otpCode,
              },
            ],
          },
        ],
      },
    };

    try {
      console.log(`[WhatsAppService] Sending OTP to ${formattedTo} using template '${templateName}'...`);

      let response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payloadWithButton),
        signal: AbortSignal.timeout(10000),
      });

      let resData = null;
      try {
        resData = await response.json();
      } catch (jsonErr) {
        resData = { raw: await response.text() };
      }

      // If button component caused an issue, retry once with body component only
      if (!response.ok && resData?.error?.message?.toLowerCase().includes('button')) {
        console.warn('[WhatsAppService] Button parameter failed, retrying with body only...');
        const payloadBodyOnly = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: formattedTo,
          type: 'template',
          template: {
            name: templateName,
            language: { code: 'en' },
            components: [
              {
                type: 'body',
                parameters: [{ type: 'text', text: otpCode }],
              },
            ],
          },
        };

        response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payloadBodyOnly),
          signal: AbortSignal.timeout(10000),
        });

        try {
          resData = await response.json();
        } catch {
          resData = null;
        }
      }

      if (response.ok && resData?.messages?.length > 0) {
        const messageId = resData.messages[0].id;
        console.log(`[WhatsAppService] OTP sent successfully to ${formattedTo}. Message ID: ${messageId}`);
        return {
          success: true,
          messageId,
          data: resData,
        };
      }

      console.error('[WhatsAppService] Meta API Error Response:', JSON.stringify(resData));
      return {
        success: false,
        status: response.status,
        error: resData?.error?.message || 'Meta WhatsApp API returned an error.',
        metaError: resData?.error,
      };
    } catch (err) {
      console.error('[WhatsAppService] Network/Request Exception:', err.message);
      return {
        success: false,
        error: err.message,
      };
    }
  }
}

module.exports = WhatsAppService;
