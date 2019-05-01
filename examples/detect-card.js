
const RPiMfrc522 = require('../lib/index.js'); // NOTE: normally this would be require('rpi-mfrc522');

// create an instance of the rpi-mfrc522 class using the default settings
let mfrc522 = new RPiMfrc522();

// initialize the class instance then start the detect card loop
mfrc522.init()
  .then(() => {
    loop();
  })
  .catch(error => {
    console.log('ERROR:', error.message)
  });


// loop method to start detecting a card
function loop () {
  console.log('Loop start...');
  cardDetect()
    .catch(error => {
      console.log('ERROR', error.message);
    });
}


// delay then call loop again
function reLoop () {
  setTimeout(loop, 25);
}


// call the rpi-mfrc522 methods to detect a card
async function cardDetect () {
  // use the cardPresent() method to detect if one or more cards are in the PCD field
  if (!(await mfrc522.cardPresent())) {
    console.log('No card')
    return reLoop();
  }
  // use the antiCollision() method to detect if only one card is present and return the cards UID
  let uid = await mfrc522.antiCollision();
  if (!uid) {
    // there may be multiple cards in the PCD field
    console.log('Collision');
    return reLoop();
  }
  console.log('Card detected, UID ' + uidToString(uid));
  await mfrc522.resetPCD()
  reLoop();
}


// convert the array of UID bytes to a hex string
function uidToString(uid) {
  return uid.reduce((s, b) => { return s + (b < 16 ? '0' : '') + b.toString(16); }, '');
}
