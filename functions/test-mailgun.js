// Simple Mailgun test function - Updated to refresh env vars
export async function handler(event, context) {
  console.log('Testing Mailgun API directly...');
  
  try {
    const params = new URLSearchParams();
    params.append('from', `ExaMark Test <noreply@${process.env.MAILGUN_DOMAIN}>`);
    params.append('to', 'coltonelliott34@gmail.com');
    params.append('subject', 'Mailgun API Test');
    params.append('text', 'This is a simple test message from the Mailgun API.');
    
    console.log('Sending with domain:', process.env.MAILGUN_DOMAIN);
    console.log('API Key exists:', !!process.env.MAILGUN_API_KEY);
    
    const response = await fetch(`https://api.mailgun.net/v3/${process.env.MAILGUN_DOMAIN}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`api:${process.env.MAILGUN_API_KEY}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString()
    });

    let result;
    try {
      const responseText = await response.text();
      console.log('Raw response:', responseText);
      result = JSON.parse(responseText);
    } catch (parseError) {
      const responseText = await response.text();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: `Parse error: ${parseError.message}`,
          statusCode: response.status,
          responseText: responseText.substring(0, 500)
        })
      };
    }

    if (response.ok) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          messageId: result.id,
          message: result.message || 'Email sent successfully'
        })
      };
    } else {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: result.message || 'Unknown error',
          statusCode: response.status,
          details: result
        })
      };
    }
    
  } catch (error) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
}
