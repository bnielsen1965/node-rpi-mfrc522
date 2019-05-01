const RPiMfrc522 = require('../lib/index.js'); // NOTE: normally this would be require('rpi-mfrc522');

let mfrc522 = new RPiMfrc522();
let key = [0xFF,0xFF,0xFF,0xFF,0xFF,0xFF];

mfrc522.init()
.then(() => {
  loop();
})
.catch(error => {
  console.log('ERROR:', error.message)
});


function loop () {
  console.log('Loop start...');
  cardTest()
  .catch(error => {
    console.log('ERROR', error.message);
  });
}


function reLoop () {
  setTimeout(loop, 50);
}

async function cardTest () {
  await mfrc522.stopCrypto1();
  if (!(await mfrc522.cardPresent())) {
    console.log('No card')
    return reLoop();
  }
  let uid = await mfrc522.antiCollision();
  if (!uid) {
    console.log('Collision');
    return reLoop();
  }
  let select = await mfrc522.selectCard(uid);
  if (!select) {
    console.log('Select failed');
    return reLoop();
  }
  let auth = await mfrc522.auth1A(8, key, uid);
  if (!auth) {
    console.log('Auth failed');
    return reLoop();buff
  }
  let sector = await mfrc522.readSector(8);
  if (!sector) {
    console.log('Read sector failed');
    return reLoop();
  }
  console.log('Sector', sector)
  let newSector = (
    sector[0] === 0 ?
    [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF] :
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  );
  let write = await mfrc522.writeSector(8, newSector);
  if (!write) {
    console.log('Write failed');
    return reLoop();
  }
//  await mfrc522.stopCrypto1();
//  await mfrc522.idlePCD();
  await mfrc522.resetPCD()
  reLoop();
}

function uidToString(uid) {
  return uid.reduce((s, b) => { return s + (b < 16 ? '0' : '') + b.toString(16); }, '');
}
