// Scheduled function to trigger background workers
// This function should be called periodically (e.g., every minute) to process queued tasks

exports.handler = async (event, context) => {
  console.log('⏰ [SCHEDULER] Starting background worker scheduler');
  
  const results = {
    emailWorker: null,
    storageWorker: null,
    timestamp: new Date().toISOString()
  };
  
  try {
    // Trigger email sender worker
    console.log('⏰ [SCHEDULER] Triggering email sender worker...');
    try {
      const emailWorkerResponse = await fetch(`${process.env.URL}/.netlify/functions/email-sender`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ trigger: 'scheduler' })
      });
      
      const emailWorkerResult = await emailWorkerResponse.json();
      results.emailWorker = {
        success: emailWorkerResponse.ok,
        status: emailWorkerResponse.status,
        result: emailWorkerResult
      };
      
      console.log('⏰ [SCHEDULER] Email worker result:', emailWorkerResult);
    } catch (emailError) {
      console.error('❌ [SCHEDULER] Email worker failed:', emailError);
      results.emailWorker = {
        success: false,
        error: emailError.message
      };
    }
    
    // Trigger storage worker
    console.log('⏰ [SCHEDULER] Triggering storage worker...');
    try {
      const storageWorkerResponse = await fetch(`${process.env.URL}/.netlify/functions/storage-worker`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ trigger: 'scheduler' })
      });
      
      const storageWorkerResult = await storageWorkerResponse.json();
      results.storageWorker = {
        success: storageWorkerResponse.ok,
        status: storageWorkerResponse.status,
        result: storageWorkerResult
      };
      
      console.log('⏰ [SCHEDULER] Storage worker result:', storageWorkerResult);
    } catch (storageError) {
      console.error('❌ [SCHEDULER] Storage worker failed:', storageError);
      results.storageWorker = {
        success: false,
        error: storageError.message
      };
    }
    
    const overallSuccess = results.emailWorker?.success && results.storageWorker?.success;
    
    console.log('⏰ [SCHEDULER] Scheduler completed. Overall success:', overallSuccess);
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        message: 'Background workers triggered',
        results,
        overallSuccess
      })
    };
    
  } catch (error) {
    console.error('❌ [SCHEDULER] Scheduler error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        message: 'Scheduler failed',
        results
      })
    };
  }
};

// This function can also be called directly for manual trigger
exports.triggerWorkers = async () => {
  return await exports.handler({}, {});
};
