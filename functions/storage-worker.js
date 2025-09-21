// Background worker function for processing queued storage tasks
// This function runs separately from the main webhook to avoid timeout issues

const { ZillizApi } = require('./mailgun-webhook.js');

exports.handler = async (event, context) => {
  console.log('💾 [STORAGE WORKER] Background worker started');
  
  try {
    // Check for required environment variables
    if (!process.env.ZILLIZ_ENDPOINT || !process.env.ZILLIZ_TOKEN) {
      throw new Error('Missing Zilliz credentials');
    }
    
    // Initialize Zilliz client
    const zilliz = new ZillizApi(process.env.ZILLIZ_ENDPOINT, process.env.ZILLIZ_TOKEN);
    
    // Query for pending storage tasks
    const searchResult = await zilliz.search({
      collection_name: 'storage_tasks',
      data: [[0, 0, 0, 0, 0]], // Dummy vector for metadata search
      filter: 'status == "pending"',
      limit: 10,
      output_fields: ['task_id', 'task_data', 'created_at', 'status', 'task_type']
    });
    
    console.log('💾 [STORAGE WORKER] Found', searchResult.data?.length || 0, 'pending storage tasks');
    
    if (!searchResult.data || searchResult.data.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'No pending storage tasks found',
          processed: 0
        })
      };
    }
    
    let successCount = 0;
    let errorCount = 0;
    const results = [];
    
    // Process each pending task
    for (const task of searchResult.data) {
      const taskId = task.task_id;
      const taskData = JSON.parse(task.task_data);
      const taskType = task.task_type;
      
      console.log('💾 [STORAGE WORKER] Processing task:', taskId, 'Type:', taskType);
      
      try {
        // Update task status to "processing"
        await zilliz.upsert({
          collection_name: 'storage_tasks',
          data: [{
            id: task.id,
            task_id: taskId,
            task_data: task.task_data,
            task_type: taskType,
            created_at: task.created_at,
            status: 'processing',
            vector: [0, 0, 0, 0, 0] // Dummy vector
          }]
        });
        
        let storageResult;
        
        // Execute the appropriate storage operation based on task type
        if (taskType === 'lead_message') {
          storageResult = await storeLeadMessage(taskData.emailData, taskData.trackingId);
          console.log('💾 [STORAGE WORKER] Lead message stored for task', taskId);
        } else if (taskType === 'ai_response') {
          storageResult = await storeReplyInZilliz(taskData.emailData, taskData.trackingId, taskData.aiResponse);
          console.log('💾 [STORAGE WORKER] AI response stored for task', taskId);
        } else {
          throw new Error(`Unknown task type: ${taskType}`);
        }
        
        // Update task status to "completed"
        await zilliz.upsert({
          collection_name: 'storage_tasks',
          data: [{
            id: task.id,
            task_id: taskId,
            task_data: task.task_data,
            task_type: taskType,
            created_at: task.created_at,
            status: 'completed',
            completed_at: new Date().toISOString(),
            result: JSON.stringify(storageResult),
            vector: [0, 0, 0, 0, 0] // Dummy vector
          }]
        });
        
        successCount++;
        results.push({
          taskId,
          taskType,
          success: true,
          storageResult
        });
        
      } catch (error) {
        console.error('❌ [STORAGE WORKER] Failed to process task', taskId, ':', error);
        
        // Update task status to "failed"
        try {
          await zilliz.upsert({
            collection_name: 'storage_tasks',
            data: [{
              id: task.id,
              task_id: taskId,
              task_data: task.task_data,
              task_type: taskType,
              created_at: task.created_at,
              status: 'failed',
              completed_at: new Date().toISOString(),
              error: error.message,
              vector: [0, 0, 0, 0, 0] // Dummy vector
            }]
          });
        } catch (updateError) {
          console.error('❌ [STORAGE WORKER] Failed to update task status:', updateError);
        }
        
        errorCount++;
        results.push({
          taskId,
          taskType,
          success: false,
          error: error.message
        });
      }
    }
    
    console.log('💾 [STORAGE WORKER] Processing complete. Success:', successCount, 'Errors:', errorCount);
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        message: 'Storage tasks processed',
        processed: successCount + errorCount,
        successful: successCount,
        failed: errorCount,
        results
      })
    };
    
  } catch (error) {
    console.error('❌ [STORAGE WORKER] Worker error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        message: 'Storage worker failed'
      })
    };
  }
};

// Function to store lead message in Zilliz
async function storeLeadMessage(emailData, trackingId) {
  console.log('💾 [STORAGE WORKER] Storing lead message...');
  
  if (!process.env.ZILLIZ_ENDPOINT || !process.env.ZILLIZ_TOKEN) {
    throw new Error('Missing Zilliz credentials');
  }
  
  const zilliz = new ZillizApi(process.env.ZILLIZ_ENDPOINT, process.env.ZILLIZ_TOKEN);
  
  // Create lead message entry
  const leadMessageData = {
    id: Math.floor(Math.random() * 1000000000),
    tracking_id: trackingId,
    message_type: 'lead_message',
    sender: emailData.sender,
    subject: emailData.subject,
    body: emailData.body,
    timestamp: emailData.timestamp,
    vector: [0.1, 0.2, 0.3, 0.4, 0.5] // Simple dummy vector
  };
  
  const result = await zilliz.upsert({
    collection_name: 'email_conversations',
    data: [leadMessageData]
  });
  
  console.log('💾 [STORAGE WORKER] Lead message storage result:', result);
  return result;
}

// Function to store AI reply in Zilliz
async function storeReplyInZilliz(emailData, trackingId, aiResponse) {
  console.log('💾 [STORAGE WORKER] Storing AI response...');
  
  if (!process.env.ZILLIZ_ENDPOINT || !process.env.ZILLIZ_TOKEN) {
    throw new Error('Missing Zilliz credentials');
  }
  
  const zilliz = new ZillizApi(process.env.ZILLIZ_ENDPOINT, process.env.ZILLIZ_TOKEN);
  
  // Create AI response entry
  const aiResponseData = {
    id: Math.floor(Math.random() * 1000000000),
    tracking_id: trackingId,
    message_type: 'ai_response',
    original_sender: emailData.sender,
    original_subject: emailData.subject,
    ai_response: aiResponse.response,
    intent: aiResponse.intent || null,
    sentiment: aiResponse.sentiment || null,
    timestamp: new Date().toISOString(),
    vector: [0.2, 0.3, 0.4, 0.5, 0.6] // Simple dummy vector
  };
  
  const result = await zilliz.upsert({
    collection_name: 'email_conversations',
    data: [aiResponseData]
  });
  
  console.log('💾 [STORAGE WORKER] AI response storage result:', result);
  return result;
}
