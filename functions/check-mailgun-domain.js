// Check Mailgun domain status
export async function handler(event, context) {
  console.log('Checking Mailgun domain status...');
  
  try {
    // Check domain information
    const response = await fetch(`https://api.mailgun.net/v3/domains/${process.env.MAILGUN_DOMAIN}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${btoa(`api:${process.env.MAILGUN_API_KEY}`)}`,
      }
    });

    const result = await response.json();
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: response.ok,
        domain: process.env.MAILGUN_DOMAIN,
        status: result,
        apiKeyExists: !!process.env.MAILGUN_API_KEY,
        apiKeyLength: process.env.MAILGUN_API_KEY?.length || 0
      })
    };
    
  } catch (error) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message,
        domain: process.env.MAILGUN_DOMAIN
      })
    };
  }
}
