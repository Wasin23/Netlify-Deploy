// Netlify function to debug environment variables
export async function handler(event, context) {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      success: true,
      environment: {
        hasZillizEndpoint: !!process.env.ZILLIZ_ENDPOINT,
        hasZillizToken: !!process.env.ZILLIZ_TOKEN,
        hasMailgunKey: !!process.env.MAILGUN_API_KEY,
        hasMailgunDomain: !!process.env.MAILGUN_DOMAIN,
        hasOpenAI: !!process.env.OPENAI_API_KEY,
        nodeEnv: process.env.NODE_ENV,
        netlifyDev: process.env.NETLIFY_DEV
      },
      timestamp: new Date().toISOString()
    })
  };
}
