async function executeOArbFlow() {

}

executeOArbFlow()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error('Caught error while running:', error);
    process.exit(1);
  });
