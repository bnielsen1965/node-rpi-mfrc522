# rpi-mfrc522

A NodeJS module that provides methods to operate an MFRC522 RFID card reader
connected to a Raspberry Pi through the SPI interface.


# install

In your node project directory use npm to install the module...
```shell
npm install --save rpi-mfrc522
```


# usage

In your node application require the rpi-mfrc522 module, create an instance from
the module, and begin calling the rpi-mfrc522 module methods to control the MFRC522
board attached to the SPI interface.


## detect card example

This example assumes the Raspberry Pi is configured with SPI device 0.0 enabled and
the MFRC522 board is connected to the Raspberry SPI pins for device 0.0.

```javascript
const RPiMfrc522 = require('rpi-mfrc522');

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
```


# methods

## constructor

The rpi-mfrc522 module is a Javascript class with a constructor. Create a new instance
with the new operator and pass an object with any needed settings overrides.

I.E.
```javascript
// load the module
const RPiMfrc522 = require('rpi-mfrc522');

// create an instance of the rpi-mfrc522 class
let mfrc522 = new RPiMfrc522({
  resetGPIO: 18, // override the default hardware reset GPIO of 25
  spiDevice: 1   // override the default spi device number of 0
});
```


### resetGPIO

The restGPIO setting is the GPIO number that is used for the hardware reset on the
MFRC522 board. The default GPIO is 25.


### resetTime

The resetTime setting is the number of milliseconds the reset pin will be held low
when the hardware reset method is called. The default is 250 milliseconds.


### spiBus

The spiBus setting is the number of the SPI bus that is used. The default value is 0
for /dev/spidev0.0

### spiDevice

The spiDevice setting is the number of the SPI device that is used. the default value
is 0 for /dev/spidev0.0


## init ()

The init method is asynchronous and should be called before using other methods from
an instance of rpi-mfrc522.

I.E.
```javascript
const RPiMfrc522 = require('rpi-mfrc522');
let mfrc522 = new RPiMfrc522();

// initialize the class instance then start the detect card loop
mfrc522.init()
  .then(() => {
    console.log('Init complete');
  })
  .catch(error => {
    console.log('ERROR:', error.message)
  });
```


## destroy ()

Call the asynchronous destroy() method when finished with the rpi-mfrc522 instance and all resources
will be released.
I.E.
```javascript
mfrc522.destroy()
  .then(() => {
    console.log('rpi-mfrc522 instance destroyed');
    process.exit(0);
  })
  .catch(error => {
    console.log('rpi-mfrc522 instance destroy failed');
    process.exit(1);
  });
```


## cardPresent ()

The asynchronous cardPresent() method is used to check if one or more cards are
present in the electrical field of the MFRC522.
I.E.
```Javascript
mfrc522.cardPresent()
  .then(present => {
    if (present) {
      console.log('Card present');
    }
    else {
      console.log('No card present');
    }
  })
  .catch(error => {
    console.log('Error checking for present card.', error.message);
  });
```


## antiCollision ()

After a card is detected in the field use the antiCollision() asynchronous method
to verify if only one card is detected and return the UID array for the card.
I.E.
```javascript
mfrc522.antiCollision()
  .then(uid => {
    if (uid) {
      console.log('Anti-collision success, UID array:', uid);
    }
    else {
      console.log('Collision, multiple cards in the field?');
    }
  })
  .catch(error => {
    console.log('Error checking anti-collision.', error.message);
  });
```


## selectCard (uid)

Prepare to communicate with a detected card by selecting the card with the asynchronous
selectCard() method.
I.E.
```Javascript
mfrc522.selectCard(uid)
  .then(select => {
    if (select) {
      console.log('Card successfully selected.');
    }
    else {
      console.log('Failed to select card.');
    }
  })
  .catch(error => {
    console.log('Error selecting card.', error.message);
  });
```


## auth1A (sector, key, uid)

Attempt authentication with a selected card using the specified memory sector on the
card, with the provided key array and card uid array.
I.E.
```javascript
let key = [0xFF,0xFF,0xFF,0xFF,0xFF,0xFF]; // default manufacturer key
mfrc522.auth1A(8, key, uid)
  .then(auth => {
    if (auth) {
      console.log('Authentication successful.');
    }
    else {
      console.log('Authentication failed.');
    }
  })
  .catch(error => {
    console.log('Error authenticating.', error.message);
  });
```


## stopCrypto1()

Stop cryptographic communication between the MFRC522 board and the RFID card.
I.E.
```Javascript
mfrc522.stopCrypto1()
  .then(() => {
    console.log('Crypto communication stopped.');
  })
  .catch(error => {
    console.log('Error stopping crypto.', error.message);
  });
```


## readSector (sector)

After authentication it is possible to read the 16 byte sector on the card.
I.E.
```Javascript
mfrc522.readSector(8)
  .then(data => {
    console.log('Sector 8:', data);
  })
  .catch(error => {
    console.log('Error reading sector.', error.message);
  });
```


## writeSector (sector, data)

Write 16 bytes to a sector.
```javascript
mfrc522.writeSector(8, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  .then(write => {
    if (writeSPI) {
      console.log('Write successful.');
    }
    else {
      console.log('Write failed.');
    }
  })
  .catch(error => {
    console.log('Error writing sector.', error.message);
  });
```


## idlePCD ()

Place the MFRC522 in an idle state.
```javascript
mfrc522.idlePCD()
  .catch(error => {
    console.log('Error idling PCD.', error.message);
  });
```


## resetPCD ()

Software reset the MFRC522.
```javascript
mfrc522.resetPCD()
  .catch(error => {
    console.log('Error resetting PCD.', error.message);
  });
```


## hardwareReset ()

Perform a hardware reset on the MFRC522
```javascript
mfrc522.hardwareReset()
  .catch(error => {
    console.log('Error hardware resetting PCD.', error.message);
  });
```


# TODO

* implement key write
