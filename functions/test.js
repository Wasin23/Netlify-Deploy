exports.handler = async (event, context) => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/plain'
    },
    body: 'Function is working!'
  };
};
