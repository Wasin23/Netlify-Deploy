// Background worker function for processing queued email sending tasks
// This function runs separately from the main webhook to avoid timeout issues

const { MilvusClient } = require('@zilliz/milvus2-sdk-node');

// Simple Zilliz API wrapper
class ZillizApi {
  constructor(endpoint, token) {
    this.client = new MilvusClient({
      address: endpoint,
      token: token
    });
  }

  async search(params) {
    return await this.client.search(params);
  }

  async upsert(params) {
    return await this.client.upsert(params);
  }
}

exports.handler = async (event, context) => {
  console.log('📧 [EMAIL SENDER] Background worker started');
  
  try {
    // Check for required environment variables
    if (!process.env.ZILLIZ_ENDPOINT || !process.env.ZILLIZ_TOKEN) {
      throw new Error('Missing Zilliz credentials');
    }
    
    if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
      throw new Error('Missing Mailgun credentials');
    }
    
    // Initialize Zilliz client
    const zilliz = new ZillizApi(process.env.ZILLIZ_ENDPOINT, process.env.ZILLIZ_TOKEN);
    
    // Query for pending email tasks
    const searchResult = await zilliz.search({
      collection_name: 'email_tasks',
      data: [[0, 0, 0, 0, 0]], // Dummy vector for metadata search
      filter: 'status == "pending"',
      limit: 10,
      output_fields: ['task_id', 'task_data', 'created_at', 'status']
    });
    
    console.log('📧 [EMAIL SENDER] Found', searchResult.data?.length || 0, 'pending email tasks');
    
    if (!searchResult.data || searchResult.data.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'No pending email tasks found',
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
      
      console.log('📧 [EMAIL SENDER] Processing task:', taskId);
      
      try {
        // Update task status to "processing"
        await zilliz.upsert({
          collection_name: 'email_tasks',
          data: [{
            id: task.id,
            task_id: taskId,
            task_data: task.task_data,
            created_at: task.created_at,
            status: 'processing',
            vector: [0, 0, 0, 0, 0] // Dummy vector
          }]
        });
        
        // Send the email
        const emailResult = await sendAutoResponse(
          taskData.emailData,
          taskData.aiResponse.response,
          taskData.trackingId
        );
        
        console.log('📧 [EMAIL SENDER] Email sent for task', taskId, ':', emailResult.success);
        
        // Update task status to "completed"
        await zilliz.upsert({
          collection_name: 'email_tasks',
          data: [{
            id: task.id,
            task_id: taskId,
            task_data: task.task_data,
            created_at: task.created_at,
            status: 'completed',
            completed_at: new Date().toISOString(),
            result: JSON.stringify(emailResult),
            vector: [0, 0, 0, 0, 0] // Dummy vector
          }]
        });
        
        successCount++;
        results.push({
          taskId,
          success: true,
          emailResult
        });
        
      } catch (error) {
        console.error('❌ [EMAIL SENDER] Failed to process task', taskId, ':', error);
        
        // Update task status to "failed"
        try {
          await zilliz.upsert({
            collection_name: 'email_tasks',
            data: [{
              id: task.id,
              task_id: taskId,
              task_data: task.task_data,
              created_at: task.created_at,
              status: 'failed',
              completed_at: new Date().toISOString(),
              error: error.message,
              vector: [0, 0, 0, 0, 0] // Dummy vector
            }]
          });
        } catch (updateError) {
          console.error('❌ [EMAIL SENDER] Failed to update task status:', updateError);
        }
        
        errorCount++;
        results.push({
          taskId,
          success: false,
          error: error.message
        });
      }
    }
    
    console.log('📧 [EMAIL SENDER] Processing complete. Success:', successCount, 'Errors:', errorCount);
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        message: 'Email tasks processed',
        processed: successCount + errorCount,
        successful: successCount,
        failed: errorCount,
        results
      })
    };
    
  } catch (error) {
    console.error('❌ [EMAIL SENDER] Worker error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        message: 'Email sender worker failed'
      })
    };
  }
};

// Function to automatically send AI response via Mailgun
async function sendAutoResponse(emailData, aiResponse, trackingId) {
  console.log('📧 [EMAIL SENDER] Sending auto-response...');
  
  if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
    throw new Error('Missing Mailgun configuration');
  }

  const formData = new FormData();
  
  // Basic email setup
  formData.append('from', `ExaMark AI <ai@${process.env.MAILGUN_DOMAIN}>`);
  formData.append('to', emailData.sender);
  formData.append('subject', `Re: ${emailData.subject}`);
  formData.append('text', aiResponse);
  formData.append('html', `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      ${aiResponse.replace(/\n/g, '<br>')}
      <br><br>
      <div style="border-top: 1px solid #eee; padding-top: 10px; margin-top: 20px; font-size: 12px; color: #888;">
        <p>This is an automated response from ExaMark AI. If you need immediate assistance, please call us directly.</p>
      </div>
    </div>
  `);
  
  // Add tracking pixel if trackingId is available
  if (trackingId) {
    const originalMessageId = `<${trackingId}@examark.ai>`;
    formData.append('h:Message-ID', originalMessageId);
    formData.append('h:In-Reply-To', emailData.messageId || '');
    formData.append('h:References', emailData.messageId || '');
    
    // Add tracking pixel to HTML
    const pixelUrl = `https://examarkchat.netlify.app/.netlify/functions/track-pixel?id=${trackingId}&type=email_open`;
    const trackingPixel = `<img src="${pixelUrl}" width="1" height="1" style="display:none;" alt="">`;
    
    const currentHtml = formData.get('html');
    formData.set('html', currentHtml + trackingPixel);
  }

  try {
    const response = await fetch(`https://api.mailgun.net/v3/${process.env.MAILGUN_DOMAIN}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString('base64')}`
      },
      body: formData
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log('📧 [EMAIL SENDER] Email sent successfully:', result.id);
      return {
        success: true,
        messageId: result.id,
        message: 'Email sent successfully'
      };
    } else {
      console.error('❌ [EMAIL SENDER] Failed to send email:', result);
      return {
        success: false,
        error: result.message || 'Failed to send email',
        details: result
      };
    }
  } catch (error) {
    console.error('❌ [EMAIL SENDER] Error sending email:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
