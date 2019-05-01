'use strict';

const RpiSysfsIO = require('rpi-sysfs-io');
const SPIDevice = require('spi-device');

const MAX_LEN = 16;

const COMMAND_REGISTER = 0x01; // set command to execute, power state bits
const COMMIEN_REGISTER = 0x02; // enable / disable interrupts
const DIVLEN_REGISTER = 0x03;  // IRQ pin output type, additional irq enable / disable settings
const COMMIRQ_REGISTER = 0x04; // interrupt request bits
const DIVIRQ_REGISTER = 0x05; // additional irq request bits
const ERROR_REGISTER = 0x06;  // error flag bits
const STATUS1_REGISTER = 0x07; // status bits for CRC,interrupt and FIFO buffer
const STATUS2_REGISTER = 0x08; // status bits for transmitter and data mode detector
const FIFODATA_REGISTER = 0x09; // data input / output for 64-byte FIFO buffer
const FIFOLEVEL_REGISTER = 0x0A; // Number of bytes stored in FIFO
const FIFOWATERLEVEL_REGISTER = 0x0B; // setting for FIFO under/over flow warning
const CONTROL_REGISTER = 0x0C; // miscellaneous control bits
const BITFRAMING_REGISTER = 0x0D; // transceiver bit framing settings, start send bit
const COLLISION_REGISTER = 0x0E; //
const MODE_REGISTER = 0x11; // general mode settings for transmit and receive
const TXCONTROL_REGISTER = 0x14; // Logical behavior settings for antenna driver pins
const TXASK_REGISTER = 0x15; // transmit ASK modulation settings
const CRCRESULTM_REGISTER = 0x21;
const CRCRESULTL_REGISTER = 0x22;
const TMODE_REGISTER = 0x2A; // timer settings, includes TPrescaler_Hi bits
const TPRESCALER_REGISTER = 0x2B; // timer prescaller Lo bits
const TRELOAD_HIGH_REGISTER = 0x2C; // hi bits for 16 bit timer reload value
const TRELOAD_LOW_REGISTER = 0x2D; // lo bits for 16 bit timer reload value

const PCD_IDLE = 0x00; // no action, cancel current command execution
const PCD_MEM = 0x01; // store 25 bytes in the internal buffer
const PCD_GENID = 0x02; // generate 10-byte random ID number
const PCD_CALCCRC = 0x03; // activate CRC coprocessor or performs self test
const PCD_TRANSMIT = 0x04; // transmit data from FIFO buffer
const PCD_CMDCHANGE = 0x07; // no command change, modify command register without affecting command, i.e. power down bit
const PCD_RECEIVE = 0x08; // activate the receiver circuits
const PCD_TRANSCEIVE = 0x0C; // transmit FIFO buffer and auto activate receiver
const PCD_AUTHENTICATE = 0x0E; // perform MIFARE standard authentication as reader
const PCD_RESET = 0x0F; // reset the MFRC522

const PICC_REQIDL = 0x26; // REQA expects ATQA response if card present
const PICC_REQALL = 0x52;
const PICC_ANTICOLL = 0x93;
const PICC_SELECTTAG = 0x93;
const PICC_AUTHENT1A = 0x60;
const PICC_AUTHENT1B = 0x61;
const PICC_READ = 0x30;
const PICC_WRITE = 0xA0;
const PICC_DECREMENT = 0xC0;
const PICC_INCREMENT = 0xC1;
const PICC_RESTORE = 0xC2;
const PICC_TRANSFER = 0xB0;
const PICC_HALT = 0x50;

const MI_OK = 0;
const MI_NOTAGERR = 1;
const MI_ERR = 2;

const Defaults = {
  resetGPIO: 25,
  resetTime: 250,
  spiBus: 0,
  spiDevice: 0
};

class RPiMfrc522 {
  constructor (settings) {
    this.settings = Object.assign({}, Defaults, settings);
    this.gpio = new RpiSysfsIO();
    this.autoExport();
  }

  // auto export underscored class methods
  autoExport () {
    let self = this;
    Object.getOwnPropertyNames(Object.getPrototypeOf(self)).forEach(function (name) {
      if (/^_[^_]+/.test(name)) {
        self[name.replace(/^_/, '')] = self[name].bind(self);
      }
    });
  }


  async _init () {
    // make sure the GPIO is exported
    if (!(await this.gpio.isExportedGPIO(this.settings.resetGPIO))) {
      await this.gpio.exportGPIO(this.settings.resetGPIO, true);
    }
    await this.gpio.directionGPIO(this.settings.resetGPIO, 'out');
    await this.hardwareReset();
    this.spi = await this.openSPI(this.settings.spiBus, this.settings.spiDevice);
    await this.resetPCD();
    await this.wait(25);
  }

  async _destroy () {
    await this.gpio.unexportGPIO(this.settings.resetGPIO);
    await this.closeSPI(this.spi);
  }


  async _cardPresent () {
    await this.writeSPI(BITFRAMING_REGISTER, 0x07); // 7 bits of last byte will be transmitted
    let r = await this.toCard(PCD_TRANSCEIVE, [PICC_REQIDL]);
    // expect status OK and received 1 byte
    if (r.status !== MI_OK || r.backLen !== 0x10) {
      r.status = MI_ERR;
    }
    return r.status === MI_OK;
  }

  async _antiCollision () {
    await this.writeSPI(BITFRAMING_REGISTER, 0x00); // all bits of last byte will be transmitted
    let r = await this.toCard(PCD_TRANSCEIVE, [PICC_ANTICOLL, 0x20]); // 2 bytes + 0 extra bits
    if (r.status !== MI_OK) {
      return false;
    }
    if (r.backData.length !== 5) {
      return false;
    }
    if (this.uidChecksum(r.backData.slice(0, 4)) !== r.backData[4]) {
      return false;
    }
    return r.backData.slice(0, 4);
  }

  async _selectCard (uid) {
    await this.writeSPI(COMMAND_REGISTER, PCD_IDLE);
    let buf = [PICC_SELECTTAG, 0x70].concat(uid, [this.uidChecksum(uid)]); // 7 bytes (not including crc) + 0 extra bits
    buf = buf.concat(await this.calculateCRC(buf));
    let r = await this.toCard(PCD_TRANSCEIVE, buf);
    return r.status === MI_OK;
  }

  async _auth1A (sector, key, uid) {
    let buff = [PICC_AUTHENT1A, sector].concat(key, uid);
    // Now we start the authentication itself
    let r = await this.toCard(PCD_AUTHENTICATE, buff);
    // Check if an error occurred
    if (r.status !== MI_OK) {
      return false;
    }
    // if crypto bit not set in status 2 register then auth failed
    let sr = await this.readSPI(STATUS2_REGISTER);
    if (!(sr & 0x08)) {
      return false;
    }
    return true;
  }

  async _stopCrypto1() {
    await this.clearBitMask(STATUS2_REGISTER, 0x08);
  }

  async _readSector (sector) {
    let recvData = [PICC_READ, sector];
    recvData = recvData.concat(await this.calculateCRC(recvData));
    let r = await this.toCard(PCD_TRANSCEIVE, recvData);
    if (r.status !== MI_OK) {
      return false;
    }
    return r.backData;
  }

  async _writeSector (sector, data) {
    let buff = [PICC_WRITE, sector];
    buff = buff.concat(await this.calculateCRC(buff));
    let r = await this.toCard(PCD_TRANSCEIVE, buff);
    if (r.status !== MI_OK || r.backLen !== 4 || r.backData[0] & 0x0F !== 0x0A) {
      return false;
    }
    if (r.status === MI_OK) {
      buff = [].concat(data);
      buff = buff.concat(await this.calculateCRC(buff));
      r = await this.toCard(PCD_TRANSCEIVE, buff);
      if (r.status !== MI_OK || r.backLen !== 4 || (r.backData[0] & 0x0F) !== 0x0A) {
        return false
      }
    }
    return true;
  }

  async _calculateCRC(buf) {
    await this.clearBitMask(DIVIRQ_REGISTER, 0x04);
    await this.setBitMask(FIFOLEVEL_REGISTER, 0x80); // flush FIFO buffer
    await this.idlePCD();
    for (let bi = 0; bi < buf.length; bi++) {
      await this.writeSPI(FIFODATA_REGISTER, buf[bi]);
    }
    await this.writeSPI(COMMAND_REGISTER, PCD_CALCCRC);
    let attempts = 0xFF;
    let n;
    do {
      await this.wait(5);
      n = await this.readSPI(DIVIRQ_REGISTER);
      attempts -= 1;
    } while (attempts && !(n & 0x04));
    let crcData = [];
    crcData.push(await this.readSPI(CRCRESULTL_REGISTER));
    crcData.push(await this.readSPI(CRCRESULTM_REGISTER));
    return crcData;
  }

  async _idlePCD () {
    await this.writeSPI(COMMAND_REGISTER, PCD_IDLE);
  }

  async _resetPCD () {
    await this.writeSPI(COMMAND_REGISTER, PCD_RESET);
    await this.writeSPI(TMODE_REGISTER, 0x8D); // timer auto, TPrescaler_Hi = 0x0D
    await this.writeSPI(TPRESCALER_REGISTER, 0x3E); // TPrescaler_Lo = 0x3E
    await this.writeSPI(TRELOAD_LOW_REGISTER, 30);
    await this.writeSPI(TRELOAD_HIGH_REGISTER, 0);
    await this.writeSPI(TXASK_REGISTER, 0x40); // 100% ASK modulation
    await this.writeSPI(MODE_REGISTER, 0x3D); // transmitter starts only if RF field is generated, MFIN polarity active HIGH
    await this.antennaOn();
  }

  async _toCard (command, data) {
    let backData = []
    let backLen = 0
    let status = MI_ERR
    let irqEn = 0x00
    let waitIRq = 0x00
    let lastBits = null;
    let n = 0
    let i = 0

    switch (command) {
      case PCD_AUTHENTICATE:
        irqEn = 0x12; // enable IRQs for Error and Idle
        waitIRq = 0x10; // wait for the IRQ Idle to be set
        break;

      case PCD_TRANSCEIVE:
        irqEn = 0x77; // enable all IRQs except HiAlert
        waitIRq = 0x30; // wait for IRQ idle or receiver to be set
        break;
    }

    await this.writeSPI(COMMIEN_REGISTER, irqEn | 0x80); // always set IRQ invert flag
    await this.clearBitMask(COMMIRQ_REGISTER, 0x80); // Set IRQ flags specified in COMMIEN_REGISTER
    await this.setBitMask(FIFOLEVEL_REGISTER, 0x80); // flush FIFO buffer
    await this.writeSPI(COMMAND_REGISTER, PCD_IDLE);

    while (i < data.length) {
      await this.writeSPI(FIFODATA_REGISTER, data[i]);
      i += 1;
    }

    await this.writeSPI(COMMAND_REGISTER, command);
    if (command === PCD_TRANSCEIVE) {
      await this.setBitMask(BITFRAMING_REGISTER, 0x80); // start send
    }

    i = 2000;
    while (true) {
      n = await this.readSPI(COMMIRQ_REGISTER);
      i -= 1;
      if (~((i !== 0) && ~(n & 0x01) && ~(n & waitIRq))) {
        // i hit 0, or IRQ Timer set, or the IRQ we are waiting for is set
        break;;
      }
    }

    await this.clearBitMask(BITFRAMING_REGISTER, 0x80); // end send

    if (i !== 0) {
      let ev = await this.readSPI(ERROR_REGISTER);
      if ((ev & 0x1B) === 0x00) {
        // no buffer overflow, no bit collision, no parity error, no protocol error
        status = MI_OK;
        if (n & irqEn & 0x01) {
          // IRQ Timer enabled and set
          status = MI_NOTAGERR;
        }

        if (command === PCD_TRANSCEIVE) {
          n = await this.readSPI(FIFOLEVEL_REGISTER);
          lastBits = (await this.readSPI(CONTROL_REGISTER)) & 0x07; // number of valid bits in last byte received
          // form the recieve count 0x[bytes][bits]
          if (lastBits !== 0) {
            backLen = (n - 1) * 8 + lastBits;
          }
          else {
            backLen = n * 8;
          }

          if (n === 0) {
            n = 1;
          }
          if (n > MAX_LEN) {
            n = MAX_LEN;
          }

          i = 0;
          while (i < n) {
            let fd = await this.readSPI(FIFODATA_REGISTER);
            backData.push(fd);
            i += 1;
          }
        }
      }
      else {
        status = MI_ERR;
      }
    }

    let r = { status: status, backData: backData, backLen: backLen };
    return r;
  }

  async _antennaOn () {
    let temp = await this.readSPI(TXCONTROL_REGISTER);
    if (~(temp[1] & 0x03)) {
      await this.writeSPI(TXCONTROL_REGISTER, temp | 0x03); // enable RF out on TX2 and TX1 pins
    }
  }

  async _hardwareReset () {
    await this.gpio.writeGPIO(this.settings.resetGPIO, 0);
    await this.wait(this.settings.resetTime);
    await this.gpio.writeGPIO(this.settings.resetGPIO, 1);
  }

  async _setBitMask (register, mask) {
    let temp = await this.readSPI(register);
    await this.writeSPI(register, temp | mask);
  }

  async _clearBitMask (register, mask) {
    let temp = await this.readSPI(register);
    await this.writeSPI(register, temp & (~mask));
  }

  _uidChecksum (uid) {
    return uid.reduce((c, b, i) => { return (i < 4 ? c ^ b : c); }, 0);
  }


  _writeSPI (register, value) {
    return new Promise((resolve, reject) => {
      let messages = [{
        sendBuffer: Buffer.from([(register << 1) & 0x7E, value]),
        receiveBuffer: Buffer.alloc(2),
        byteLength: 2,
        speedHz: 20000
      }];
      this.spi.transfer(messages, (error, response) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(response);
      });

    });
  }

  _readSPI (register) {
    return new Promise((resolve, reject) => {
      let messages = [{
        sendBuffer: Buffer.from([((register << 1) & 0x7E) | 0x80, 0]),
        receiveBuffer: Buffer.alloc(2),
        byteLength: 2,
        speedHz: 20000
      }];
      this.spi.transfer(messages, (error, response) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(response[0].receiveBuffer[1]);
      });
    });
  }

  _openSPI (busNumber, deviceNumber) {
    return new Promise((resolve, reject) => {
      let device = SPIDevice.open(busNumber, deviceNumber, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(device);
      });

    });
  }

  _closeSPI (device) {
    return new Promise((resolve, reject) => {
      device.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });

    });
  }


  _wait (ms) {
    return new Promise((resolve, reject) => {
      setTimeout(() => { resolve(); }, ms);
    });
  }
}

module.exports = RPiMfrc522;
