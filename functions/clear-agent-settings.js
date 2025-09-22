// Function to clear the Zilliz agent_settings collection
import { MilvusClient } from "@zilliz/milvus2-sdk-node";

const milvusClient = new MilvusClient({
  address: process.env.ZILLIZ_ENDPOINT?.trim(),
  token: process.env.ZILLIZ_TOKEN?.trim(),
});

export const handler = async (event, context) => {
  try {
    console.log('[CLEAR] Starting to clear agent_settings collection...');
    
    // Check if collection exists
    const collections = await milvusClient.listCollections();
    console.log('[CLEAR] Available collections:', collections.data);
    
    const hasAgentSettings = collections.data.some(col => col.name === 'agent_settings');
    
    if (!hasAgentSettings) {
      console.log('[CLEAR] agent_settings collection does not exist');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          message: 'agent_settings collection does not exist - nothing to clear',
          collections: collections.data
        })
      };
    }
    
    console.log('[CLEAR] agent_settings collection found, proceeding to clear...');
    
    // Load the collection first
    await milvusClient.loadCollection({ collection_name: 'agent_settings' });
    console.log('[CLEAR] Collection loaded');
    
    // Get collection stats before clearing
    const statsBefore = await milvusClient.getCollectionStatistics({ collection_name: 'agent_settings' });
    console.log('[CLEAR] Stats before clearing:', statsBefore);
    
    // Delete all entities from the collection
    const deleteResult = await milvusClient.delete({
      collection_name: 'agent_settings',
      expr: 'id >= 0' // This should match all records assuming id field exists
    });
    
    console.log('[CLEAR] Delete result:', deleteResult);
    
    // Get collection stats after clearing
    const statsAfter = await milvusClient.getCollectionStatistics({ collection_name: 'agent_settings' });
    console.log('[CLEAR] Stats after clearing:', statsAfter);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'agent_settings collection cleared successfully',
        statsBefore: statsBefore,
        statsAfter: statsAfter,
        deleteResult: deleteResult
      }, null, 2)
    };
    
  } catch (error) {
    console.error('[CLEAR] Error clearing collection:', error);
    
    // If the error is about the collection not existing or being empty, that's fine
    if (error.message?.includes('collection not found') || 
        error.message?.includes('collection is empty') ||
        error.message?.includes('no such partition')) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          message: 'Collection was already empty or does not exist',
          error: error.message
        })
      };
    }
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: error.message,
        stack: error.stack 
      })
    };
  }
}
