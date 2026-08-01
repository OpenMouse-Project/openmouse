/**
 * Orbital mouse host protocol
 *
 * Plain JavaScript. No UI, no HTML, no CSS, no images and no build step.
 *
 * This is the host-side HID protocol used by the Orbital control app. It is not
 * mouse firmware. The useful part for another project is the packet layout,
 * parsers and write flow. The small HID transport layer can be replaced.
 *
 * What is covered here:
 *   - wired mouse and wireless receiver routing
 *   - DMS v1 and DMS v2 detection
 *   - battery, charging state and live status packets
 *   - five onboard profiles
 *   - five X/Y DPI stages, enabled-stage mask and active stage
 *   - polling rate
 *   - lift-off-distance level
 *   - angle tune and angle snapping
 *   - Motion Sync and ripple control
 *   - high-performance and full-speed/overclock modes
 *   - debounce, quick response, wheel reverse and sleep time
 *   - saving settings and factory reset
 *
 * Deliberately not included:
 *   - button remapping
 *   - macros
 *   - mouse or receiver lighting
 *
 * ---------------------------------------------------------------------------
 * QUICK USE
 * ---------------------------------------------------------------------------
 *
 * Browser/WebHID:
 *
 *   const client = await OrbitalMouseClient.requestFromBrowser({
 *     logger: (message, bytes) => console.log(message, bytes),
 *   });
 *
 *   await client.open();
 *   console.log(await client.readEverything());
 *
 *   await client.applySettings({
 *     dpiStages: [[400, 400], [800, 800], [1600, 1600], [3200, 3200], [6400, 6400]],
 *     activeDpiStage: 1,
 *     reportRateIndex: reportRateHzToIndex(1000),
 *     liftOffDistance: 0,
 *     angleTuning: 0,
 *     motionSync: true,
 *     highPerformance: true,
 *   });
 *
 * Electron or another HID library:
 *
 *   Wrap its device so it exposes:
 *     vendorId, productId, productName, opened, collections,
 *     open(), close(), sendReport(), addEventListener(), removeEventListener()
 *
 *   Then pass it directly:
 *     const client = new OrbitalMouseClient(myWrappedDevice);
 *
 * ---------------------------------------------------------------------------
 * PACKET SHAPE
 * ---------------------------------------------------------------------------
 *
 * Every config packet is 64 bytes:
 *
 *   byte 0   command family
 *            bit 6 (0x40) means "route this through the receiver to the mouse"
 *   byte 2   command/opcode
 *   byte 3   subcommand
 *   bytes 4..62 payload
 *   byte 63  checksum: (0xA1 - sum(bytes 0..62)) & 0xFF
 *
 * Replies routed through the receiver usually have byte 0 with 0x40 added.
 * That is why the response checks accept values such as 4 or 68 (0x44).
 *
 * Settings writes are followed by the save command. A reply only confirms that
 * the packet arrived, so applySettings() reads everything back afterward.
 *
 * ---------------------------------------------------------------------------
 * SETTING NAMES THAT ARE EASY TO MISREAD
 * ---------------------------------------------------------------------------
 *
 *   liftOffDistance   0, 1 or 2. These are the mouse's three LOD levels, not mm.
 *   angleTuning       fixed report-axis rotation in signed degrees (-30..+30).
 *                     It does not measure live physical mouse rotation.
 *   highPerformance   maps to the device field called maxSpeedMode.
 *   overclockedMode   maps to the device field called fullSpeedMode.
 *   quickResponse     DMS v2 system setting. V1 reports false here.
 *   dpiStages         always five [x, y] pairs. X and Y may be different.
 *   enabledDpiStages  how many stages from the start are enabled (1..5).
 *   activeDpiStage    zero-based stage number (0..4).
 *   reportRateIndex   index into ORBITAL_REPORT_RATES_HZ, not literal hertz.
 *
 * The original app's supported rate table is kept exactly as found:
 *   125, 500, 1000, 2000, 4000 and 8000 Hz.
 * Raw rate value 1 is skipped by the app's encoding, so this file does not guess
 * that it means 250 Hz.
 *
 * Some v2 system bytes describe wake behavior and internal button modes. They are
 * read and preserved when writing, but are not exposed as editable controls here.
 * Zeroing those pass-through bytes could change unrelated device behavior.
 */

/**
 * @typedef {[number, number]} DpiPair
 * X DPI followed by Y DPI.
 */

/**
 * @typedef {[number, number, number]} Rgb
 * Preserved DPI-stage color from the device. Lighting control is not implemented.
 */

/**
 * @typedef {Object} OrbitalEditableSettings
 * @property {DpiPair[]} dpiStages Five X/Y DPI pairs.
 * @property {number} enabledDpiStages Number of enabled stages, 1 through 5.
 * @property {number} activeDpiStage Zero-based active stage, 0 through 4.
 * @property {number} reportRateIndex Index into ORBITAL_REPORT_RATES_HZ.
 * @property {number} sleepSeconds Sleep timeout stored by the device.
 * @property {number} debounceMs Debounce value in milliseconds.
 * @property {number} liftOffDistance Device LOD level: 0, 1 or 2.
 * @property {number} angleTuning Fixed angle correction in signed degrees.
 * @property {boolean} angleSnapping
 * @property {boolean} rippleControl
 * @property {boolean} motionSync
 * @property {boolean} highPerformance Device maxSpeedMode.
 * @property {boolean} overclockedMode Device fullSpeedMode.
 * @property {boolean} quickResponse DMS v2 only.
 * @property {boolean} wheelReverse
 */

// -----------------------------------------------------------------------------
// Public constants
// -----------------------------------------------------------------------------
const ORBITAL_VENDOR_ID = 0x1915;
const ORBITAL_REPORT_ID = 0;
const ORBITAL_PACKET_SIZE = 64;
const ORBITAL_PROFILE_COUNT = 5;
const ORBITAL_DPI_LIMITS = { min: 50, max: 30000, step: 50 };
/** The device stores report rate as an index, not the actual Hz value. */
const ORBITAL_REPORT_RATES_HZ = [125, 500, 1000, 2000, 4000, 8000];
const ORBITAL_DEVICES = new Map([
    [0x080c, { name: "Ghost / Pathfinder V2", protocol: "dms_v2", receiver: false, maxReportRateIndex: 5 }],
    [0x080b, {
            name: "Ghost / Pathfinder V2 receiver",
            protocol: "dms_v2",
            receiver: true,
            pairedProductId: 0x080c,
            maxReportRateIndex: 5,
        }],
    [0x0747, { name: "Pathfinder V1", protocol: "dms", receiver: false, maxReportRateIndex: 2 }],
    [0x0746, {
            name: "Pathfinder V1 receiver",
            protocol: "dms",
            receiver: true,
            pairedProductId: 0x0747,
            maxReportRateIndex: 2,
        }],
]);
// -----------------------------------------------------------------------------
// Main client
// -----------------------------------------------------------------------------
class OrbitalMouseClient {
    constructor(device, options = {}) {
        this.identity = null;
        this.settings = null;
        this.waiters = new Set();
        this.updateListeners = new Set();
        this.handleInputReportBound = (event) => this.handleInputReport(event);
        this.handleDisconnectBound = () => this.handleDisconnect();
        const definition = ORBITAL_DEVICES.get(device.productId);
        if (device.vendorId !== ORBITAL_VENDOR_ID || !definition) {
            throw new Error(`Unsupported Orbital device 0x${device.vendorId.toString(16)}:0x${device.productId.toString(16)}`);
        }
        this.device = device;
        this.definition = definition;
        this.protocol = definition.protocol;
        this.isReceiver = definition.receiver;
        this.timeoutMs = options.timeoutMs ?? 1800;
        this.logger = options.logger ?? (() => undefined);
    }
    /**
     * Browser helper. Electron can ignore this and pass its own device to the constructor.
     */
    static async requestFromBrowser(options = {}) {
        const hid = globalThis.navigator?.hid;
        if (!hid)
            throw new Error("WebHID is not available in this browser.");
        const selected = await hid.requestDevice({
            filters: Array.from(ORBITAL_DEVICES.keys(), (productId) => ({
                vendorId: ORBITAL_VENDOR_ID,
                productId,
                // This narrows Chromium down to the vendor configuration interface.
                usagePage: 0xff0a,
                usage: 1,
            })),
        });
        // Composite HID devices sometimes appear more than once. Prefer the collection
        // that actually carries the DMS config protocol.
        const device = selected.find(hasOrbitalConfigCollection) ?? selected[0];
        if (!device)
            throw new Error("No Orbital device was selected.");
        return new OrbitalMouseClient(device, options);
    }
    async open(readInitialState = true) {
        if (!hasOrbitalConfigCollection(this.device)) {
            throw new Error("This HID entry does not expose the Orbital config collection.");
        }
        if (!this.device.opened)
            await this.device.open();
        this.device.addEventListener("inputreport", this.handleInputReportBound);
        this.device.addEventListener("disconnect", this.handleDisconnectBound);
        try {
            const identity = await this.detectProtocol();
            if (readInitialState) {
                this.settings = await this.readSettings();
                try {
                    this.settings.power = await this.readPower();
                }
                catch (error) {
                    this.logger(`Battery read skipped: ${errorMessage(error)}`);
                }
            }
            return identity;
        }
        catch (error) {
            await this.close();
            throw error;
        }
    }
    async close() {
        this.rejectAllWaiters(new Error("Device disconnected."));
        this.device.removeEventListener("inputreport", this.handleInputReportBound);
        this.device.removeEventListener("disconnect", this.handleDisconnectBound);
        if (this.device.opened) {
            try {
                await this.device.close();
            }
            catch {
                // Closing an already-disconnected HID device throws in a few Chromium builds.
            }
        }
    }
    onLiveUpdate(listener) {
        this.updateListeners.add(listener);
        return () => this.updateListeners.delete(listener);
    }
    /**
     * Reads the useful device/settings state in one go.
     *
     * I left button maps, macros and lighting out of this handoff. This keeps the
     * file focused on profiles, DPI and the sensor/system settings OpenMouse needs.
     */
    async readEverything() {
        const identity = this.identity ?? await this.detectProtocol();
        const settings = await this.readSettings();
        const power = await this.readPower();
        settings.power = power;
        this.settings = settings;
        return { identity, settings, power };
    }
    // ---------------------------------------------------------------------------
    // Identity / basic status
    // ---------------------------------------------------------------------------
    /**
     * Handshake packet:
     *   [0] = 0x01, [2] = 0x81, [3] = 0x01
     *
     * This command targets the HID device itself. For a receiver we intentionally
     * do not set the route bit, because the reply contains receiver/pairing info.
     */
    async detectProtocol() {
        const packet = this.makePacket();
        packet[0] = 1;
        packet[2] = 129;
        packet[3] = 1;
        // This handshake is sent to the HID device itself. When the HID device is the
        // receiver, routing it through to the mouse would give us the wrong identity.
        this.finishPacket(packet, false);
        const response = await this.requestResponse(packet, (bytes) => bytes[0] === 1, "protocol handshake", 2500);
        let pairedVendorId;
        let pairedProductId;
        if (this.isReceiver && this.protocol === "dms_v2") {
            pairedVendorId = response[6] | (response[7] << 8);
            pairedProductId = response[8] | (response[9] << 8);
            if (pairedVendorId !== ORBITAL_VENDOR_ID ||
                pairedProductId !== this.definition.pairedProductId) {
                throw new Error(`Receiver is paired to 0x${toHex4(pairedVendorId)}:0x${toHex4(pairedProductId)}, not the expected mouse.`);
            }
        }
        const identity = {
            vendorId: this.device.vendorId,
            productId: this.device.productId,
            productName: this.device.productName || this.definition.name,
            definition: this.definition,
            connection: this.isReceiver ? "wireless" : "wired",
            pairedVendorId,
            pairedProductId,
            rawHandshake: response,
        };
        this.identity = identity;
        return identity;
    }
    /**
     * Reads battery state, percentage and current onboard profile.
     * The offsets differ between DMS v1 and DMS v2, so this normalizes both into
     * { state, percent, profile }.
     */
    async readPower() {
        const packet = this.packetWith([0, 1], [2, 129], [3, 1]);
        const response = await this.requestResponse(packet, (bytes) => (bytes[0] === 1 || bytes[0] === 65) && bytes[3] === 1, "read battery");
        const stateOffset = this.protocol === "dms_v2" ? 10 : 5;
        const percentOffset = this.protocol === "dms_v2" ? 11 : 6;
        const profileOffset = this.protocol === "dms_v2" ? 12 : 7;
        const rawState = response[stateOffset];
        const power = {
            // V2 uses state 3 in a live packet where the app treats it as normal battery.
            state: this.protocol === "dms_v2" && rawState === 3 ? 0 : rawState,
            percent: clamp(response[percentOffset], 0, 100),
            profile: clamp(response[profileOffset], 0, ORBITAL_PROFILE_COUNT - 1),
        };
        if (this.settings)
            this.settings.power = power;
        return power;
    }
    // ---------------------------------------------------------------------------
    // DPI / sensor / system settings
    // ---------------------------------------------------------------------------
    async readSettings() {
        const settings = this.protocol === "dms_v2"
            ? await this.readDmsV2Settings()
            : await this.readDmsSettings();
        this.settings = settings;
        return settings;
    }
    /**
     * Accepts a partial update. Missing values are copied from the current readback,
     * which matters because the write packets contain fields the UI may not expose.
     */
    async applySettings(changes) {
        const current = this.settings ?? await this.readSettings();
        const merged = this.mergeEditableSettings(current, changes);
        if (this.protocol === "dms_v2")
            await this.writeDmsV2Settings(merged, current);
        else
            await this.writeDmsSettings(merged, current);
        // Always read it back. A successful ACK only means the packet arrived; readback
        // is what tells us the values really stuck.
        return this.readSettings();
    }
    /**
     * DMS v1 keeps DPI, rate, sensor flags, LOD, angle, sleep and debounce in one
     * main settings response. The flag byte is decoded bit by bit below.
     */
    async readDmsSettings() {
        const packet = this.packetWith([0, 4], [2, 129], [3, 1]);
        const response = await this.requestResponse(packet, (bytes) => (bytes[0] === 4 || bytes[0] === 68) && bytes[3] === 1, "read DMS settings");
        const flags = response[4];
        const dpiStages = Array.from({ length: 5 }, (_, stage) => {
            const offset = 8 + stage * 4;
            return [readU16LE(response, offset), readU16LE(response, offset + 2)];
        });
        const reportRateIndex = response[5] > 1 ? response[5] - 1 : 0;
        const settings = {
            protocol: "dms",
            dpiStages,
            dpiColors: Array.from({ length: 5 }, () => [0, 0, 0]),
            enabledDpiStages: countSetBits(response[6]) || 5,
            activeDpiStage: clamp(response[7], 0, 4),
            reportRateIndex,
            reportRateHz: ORBITAL_REPORT_RATES_HZ[reportRateIndex] ?? 0,
            sleepSeconds: readU16LE(response, 52),
            debounceMs: response[54],
            sensor: {
                angleSnapping: Boolean(flags & (1 << 0)),
                maxSpeedMode: Boolean(flags & (1 << 1)),
                rippleControl: Boolean(flags & (1 << 4)),
                motionSync: Boolean(flags & (1 << 5)),
                fullSpeedMode: Boolean(flags & (1 << 6)),
                wheelReverse: Boolean(flags & (1 << 7)),
                liftDownEnable: false,
                glassMode: false,
                liftOffDistance: response[43],
                angleTuning: signedByte(response[44]),
            },
        };
        // V1 puts wheel reverse in the sensor flags. Keep it in a normalized system
        // object too, so a UI does not need separate code for V1 and V2.
        settings.system = {
            sleepSeconds: settings.sleepSeconds,
            bleSleepSeconds: settings.sleepSeconds,
            reportRateIndex,
            debounceMs: settings.debounceMs,
            quickResponse: false,
            buttonWakeupEnable: false,
            moveWakeupEnable: false,
            wheelWakeupEnable: false,
            wheelReverse: Boolean(flags & (1 << 7)),
            irButtonMode: 0,
            mouseLeftKeyMode: 0,
            mouseRightKeyMode: 0,
            rfPowerMode: 0,
            bleNum: 0,
        };
        // Remove the temporary extra property from the normalized sensor object.
        delete settings.sensor.wheelReverse;
        return settings;
    }
    /**
     * DMS v2 splits settings into two blocks:
     *
     *   sensor/DPI read: [0]=0x04, [2]=0x81, [3]=0x01
     *   system read:     [0]=0x04, [2]=0x83, [3]=0x03
     *
     * sensorData is response bytes after the four-byte command header.
     * systemData is handled the same way.
     */
    async readDmsV2Settings() {
        const sensorPacket = this.packetWith([0, 4], [2, 129], [3, 1]);
        const sensorResponse = await this.requestResponse(sensorPacket, (bytes) => (bytes[0] === 4 || bytes[0] === 68) && bytes[3] === 1, "read DMS v2 sensor settings");
        const systemPacket = this.packetWith([0, 4], [2, 131], [3, 3]);
        const systemResponse = await this.requestResponse(systemPacket, (bytes) => (bytes[0] === 4 || bytes[0] === 68) && bytes[3] === 3, "read DMS v2 system settings");
        const sensorData = sensorResponse.slice(4);
        const systemData = systemResponse.slice(4);
        const dpiStages = Array.from({ length: 5 }, (_, stage) => {
            const offset = 11 + stage * 4;
            return [readU16LE(sensorData, offset), readU16LE(sensorData, offset + 2)];
        });
        const dpiColors = Array.from({ length: 5 }, (_, stage) => {
            const offset = 39 + stage * 3;
            return [sensorData[offset], sensorData[offset + 1], sensorData[offset + 2]];
        });
        const system = {
            sleepSeconds: readU16LE(systemData, 0),
            bleSleepSeconds: readU16LE(systemData, 2),
            reportRateIndex: systemData[4] > 1 ? systemData[4] - 1 : 0,
            debounceMs: systemData[5],
            quickResponse: Boolean(systemData[6]),
            buttonWakeupEnable: Boolean(systemData[7]),
            moveWakeupEnable: Boolean(systemData[8]),
            wheelWakeupEnable: Boolean(systemData[9]),
            wheelReverse: Boolean(systemData[10]),
            irButtonMode: systemData[11],
            mouseLeftKeyMode: systemData[12],
            mouseRightKeyMode: systemData[13],
            rfPowerMode: systemData[14],
            bleNum: systemData[15],
        };
        return {
            protocol: "dms_v2",
            dpiStages,
            dpiColors,
            enabledDpiStages: countSetBits(sensorData[10]) || 5,
            activeDpiStage: clamp(sensorData[9], 0, 4),
            reportRateIndex: system.reportRateIndex,
            reportRateHz: ORBITAL_REPORT_RATES_HZ[system.reportRateIndex] ?? 0,
            sleepSeconds: system.sleepSeconds,
            debounceMs: system.debounceMs,
            sensor: {
                angleSnapping: Boolean(sensorData[0]),
                rippleControl: Boolean(sensorData[1]),
                motionSync: Boolean(sensorData[2]),
                fullSpeedMode: Boolean(sensorData[3]),
                maxSpeedMode: Boolean(sensorData[4]),
                liftDownEnable: Boolean(sensorData[5]),
                glassMode: Boolean(sensorData[6]),
                liftOffDistance: sensorData[7],
                angleTuning: signedByte(sensorData[8]),
            },
            system,
        };
    }
    /**
     * Writes DMS v1 settings.
     *
     * V1 uses several commands instead of one clean settings block:
     *   0xB5/0x02  main DPI + sensor packet
     *   0x84/0x04  polling rate
     *   0x84/0x0A  LOD + angle
     *   0x86/0x0E  sleep + debounce
     *
     * Each write is saved before moving on. Existing fields are preserved where
     * the packet contains values that this API does not edit.
     */
    async writeDmsSettings(next, previous) {
        let flags = 0;
        if (next.angleSnapping)
            flags |= 1 << 0;
        if (next.highPerformance)
            flags |= 1 << 1;
        if (next.rippleControl)
            flags |= 1 << 4;
        if (next.motionSync)
            flags |= 1 << 5;
        if (next.overclockedMode)
            flags |= 1 << 6;
        if (next.wheelReverse)
            flags |= 1 << 7;
        // Main V1 sensor/DPI packet.
        const dpiPacket = this.makePacket();
        dpiPacket[0] = 4;
        dpiPacket[2] = 181;
        dpiPacket[3] = 2;
        dpiPacket[4] = flags;
        dpiPacket[5] = encodeReportRate(next.reportRateIndex);
        dpiPacket[6] = (1 << next.enabledDpiStages) - 1;
        dpiPacket[7] = next.activeDpiStage;
        next.dpiStages.forEach((pair, stage) => {
            const offset = 8 + stage * 4;
            writeU16LE(dpiPacket, offset, pair[0]);
            writeU16LE(dpiPacket, offset + 2, pair[1]);
        });
        dpiPacket[43] = next.liftOffDistance;
        dpiPacket[44] = next.angleTuning & 0xff;
        // The packet contains old system fields too. Preserve them here and update them
        // using the dedicated command below instead of accidentally zeroing them.
        writeU16LE(dpiPacket, 50, previous.sleepSeconds);
        writeU16LE(dpiPacket, 52, previous.sleepSeconds);
        dpiPacket[54] = previous.debounceMs;
        this.finishPacket(dpiPacket);
        await this.requestResponse(dpiPacket, (bytes) => (bytes[0] === 4 || bytes[0] === 68) && bytes[3] === 2, "write V1 DPI/sensor settings");
        await this.saveSettings();
        const ratePacket = this.packetWith([0, 4], [2, 132], [3, 4], [4, encodeReportRate(next.reportRateIndex)]);
        await this.requestResponse(ratePacket, (bytes) => (bytes[0] === 4 || bytes[0] === 68) && bytes[3] === 4, "write V1 report rate");
        await this.saveSettings();
        const sensorPacket = this.packetWith([0, 4], [2, 132], [3, 10], [4, flags], [5, next.liftOffDistance], [6, next.angleTuning & 0xff]);
        await this.requestResponse(sensorPacket, (bytes) => (bytes[0] === 4 || bytes[0] === 68) && bytes[3] === 10, "write V1 LOD/angle settings");
        await this.saveSettings();
        const systemPacket = this.packetWith([0, 4], [2, 134], [3, 14], [4, next.sleepSeconds & 0xff], [5, (next.sleepSeconds >>> 8) & 0xff], [6, next.sleepSeconds & 0xff], [7, (next.sleepSeconds >>> 8) & 0xff], [8, next.debounceMs]);
        await this.requestResponse(systemPacket, (bytes) => (bytes[0] === 4 || bytes[0] === 68) && bytes[3] === 14, "write V1 debounce/sleep");
        await this.saveSettings();
    }
    /**
     * Writes DMS v2 settings.
     *
     * Sensor/DPI write packet:
     *   [0]=0x04 [2]=0xBC [3]=0x02
     *   [4..12] toggles, LOD and angle
     *   [13] active stage, [14] enabled-stage bit mask
     *   [15..34] five X/Y DPI pairs
     *   [43..57] existing stage colors, copied back unchanged
     *
     * System write packet:
     *   [0]=0x04 [2]=0x90 [3]=0x04
     *   sleep, report rate, debounce, quick response and wheel reverse
     *   plus pass-through bytes copied from the last read.
     */
    async writeDmsV2Settings(next, previous) {
        const oldSensor = previous.sensor;
        const sensorPacket = this.makePacket();
        sensorPacket[0] = 4;
        sensorPacket[2] = 188;
        sensorPacket[3] = 2;
        sensorPacket[4] = Number(next.angleSnapping);
        sensorPacket[5] = Number(next.rippleControl);
        sensorPacket[6] = Number(next.motionSync);
        sensorPacket[7] = Number(next.overclockedMode);
        sensorPacket[8] = Number(next.highPerformance);
        sensorPacket[9] = Number(oldSensor.liftDownEnable);
        sensorPacket[10] = Number(oldSensor.glassMode);
        sensorPacket[11] = next.liftOffDistance;
        sensorPacket[12] = next.angleTuning & 0xff;
        sensorPacket[13] = next.activeDpiStage;
        sensorPacket[14] = (1 << next.enabledDpiStages) - 1;
        next.dpiStages.forEach((pair, stage) => {
            const offset = 15 + stage * 4;
            writeU16LE(sensorPacket, offset, pair[0]);
            writeU16LE(sensorPacket, offset + 2, pair[1]);
        });
        previous.dpiColors.forEach((rgb, stage) => {
            const offset = 43 + stage * 3;
            sensorPacket[offset] = rgb[0] ?? 0;
            sensorPacket[offset + 1] = rgb[1] ?? 0;
            sensorPacket[offset + 2] = rgb[2] ?? 0;
        });
        this.finishPacket(sensorPacket);
        await this.requestResponse(sensorPacket, (bytes) => (bytes[0] === 4 || bytes[0] === 68) && bytes[3] === 2, "write V2 sensor/DPI settings");
        await this.saveSettings();
        const oldSystem = previous.system;
        if (!oldSystem)
            throw new Error("V2 system settings were not read before writing.");
        const systemPacket = this.makePacket();
        systemPacket[0] = 4;
        systemPacket[2] = 144;
        systemPacket[3] = 4;
        writeU16LE(systemPacket, 4, next.sleepSeconds);
        writeU16LE(systemPacket, 6, next.sleepSeconds);
        systemPacket[8] = encodeReportRate(next.reportRateIndex);
        systemPacket[9] = next.debounceMs;
        systemPacket[10] = Number(next.quickResponse);
        systemPacket[11] = Number(oldSystem.buttonWakeupEnable);
        systemPacket[12] = Number(oldSystem.moveWakeupEnable);
        systemPacket[13] = Number(oldSystem.wheelWakeupEnable);
        systemPacket[14] = Number(next.wheelReverse);
        systemPacket[15] = oldSystem.irButtonMode;
        systemPacket[16] = oldSystem.mouseLeftKeyMode;
        systemPacket[17] = oldSystem.mouseRightKeyMode;
        systemPacket[18] = oldSystem.rfPowerMode;
        systemPacket[19] = oldSystem.bleNum;
        this.finishPacket(systemPacket);
        await this.requestResponse(systemPacket, (bytes) => (bytes[0] === 4 || bytes[0] === 68) && bytes[3] === 4, "write V2 system settings");
        await this.saveSettings();
    }
    mergeEditableSettings(current, changes) {
        const reportRateIndex = clamp(changes.reportRateIndex ?? current.reportRateIndex, 0, this.definition.maxReportRateIndex);
        const dpiStages = normalizeDpiStages(changes.dpiStages ?? current.dpiStages);
        const enabledDpiStages = clamp(changes.enabledDpiStages ?? current.enabledDpiStages, 1, 5);
        return {
            dpiStages,
            enabledDpiStages,
            activeDpiStage: clamp(changes.activeDpiStage ?? current.activeDpiStage, 0, enabledDpiStages - 1),
            reportRateIndex,
            sleepSeconds: clamp(changes.sleepSeconds ?? current.sleepSeconds, 1, 0xffff),
            debounceMs: clamp(changes.debounceMs ?? current.debounceMs, 0, 30),
            liftOffDistance: clamp(changes.liftOffDistance ?? current.sensor.liftOffDistance, 0, 2),
            angleTuning: clamp(changes.angleTuning ?? current.sensor.angleTuning, -30, 30),
            angleSnapping: changes.angleSnapping ?? current.sensor.angleSnapping,
            rippleControl: changes.rippleControl ?? current.sensor.rippleControl,
            motionSync: changes.motionSync ?? current.sensor.motionSync,
            highPerformance: changes.highPerformance ?? current.sensor.maxSpeedMode,
            overclockedMode: changes.overclockedMode ?? current.sensor.fullSpeedMode,
            quickResponse: changes.quickResponse ?? current.system?.quickResponse ?? false,
            wheelReverse: changes.wheelReverse ?? current.system?.wheelReverse ?? false,
        };
    }
    // ---------------------------------------------------------------------------
    // Onboard profiles
    // ---------------------------------------------------------------------------
    /**
     * Switches the active onboard profile. Profiles are zero-based here, so 0 is
     * the mouse's Profile 1. The ACK can arrive before the switch is complete;
     * readPower() is used to verify the profile really changed.
     */
    async switchProfile(profile) {
        const target = clamp(profile, 0, ORBITAL_PROFILE_COUNT - 1);
        const command = this.protocol === "dms_v2" ? 2 : 1;
        let lastError;
        // The device sometimes ACKs before it has actually switched profile, so verify
        // using the battery/status packet instead of trusting the ACK on its own.
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                const packet = this.packetWith([0, 2], [2, 130], [3, command], [4, target]);
                await this.requestResponse(packet, (bytes) => (bytes[0] === 2 || bytes[0] === 66) && bytes[3] === command, `switch profile to ${target + 1}`, 2800);
                await this.saveSettings(2800);
            }
            catch (error) {
                lastError = error;
            }
            await delay(140 + attempt * 80);
            try {
                const power = await this.readPower();
                if (power.profile === target)
                    return power;
            }
            catch (error) {
                lastError = error;
            }
        }
        throw new Error(`Profile ${target + 1} did not activate. ${errorMessage(lastError)}`.trim());
    }
    // ---------------------------------------------------------------------------
    // Factory reset and low-level helper
    // ---------------------------------------------------------------------------
    async factoryReset() {
        const packet = this.protocol === "dms_v2"
            ? this.packetWith([0, 9], [2, 129], [3, 255], [4, 0])
            : this.packetWith([0, 9], [2, 130], [3, 0], [4, 255]);
        // Factory reset does not always send a useful ACK, so the original app sends it,
        // waits, saves, waits again, then verifies by reading the settings back.
        await this.sendPacket(packet, "factory reset");
        await delay(250);
        await this.saveSettings();
        await delay(250);
        return this.readSettings();
    }
    /**
     * Useful while OpenMouse is still wiring things up. The packet must already be
     * 64 bytes; this method handles receiver routing and checksum.
     */
    async rawCommand(packet, predicate, label = "raw Orbital command", timeoutMs = this.timeoutMs, routeToMouse = true) {
        if (packet.length !== ORBITAL_PACKET_SIZE) {
            throw new Error(`Orbital packets must be ${ORBITAL_PACKET_SIZE} bytes.`);
        }
        const copy = packet.slice();
        this.finishPacket(copy, routeToMouse);
        return this.requestResponse(copy, predicate, label, timeoutMs);
    }
    // ---------------------------------------------------------------------------
    // Transport internals
    // ---------------------------------------------------------------------------
    handleInputReport(event) {
        const view = event.data;
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
        const reportId = Number(event.reportId ?? 0);
        this.logger(`IN report 0x${reportId.toString(16).padStart(2, "0")}`, bytes);
        this.handleLiveStatus(bytes);
        for (const waiter of Array.from(this.waiters)) {
            if (!waiter.predicate(bytes, reportId))
                continue;
            this.waiters.delete(waiter);
            clearTimeout(waiter.timer);
            waiter.resolve(bytes);
        }
    }
    handleDisconnect() {
        this.rejectAllWaiters(new Error("Orbital device disconnected."));
    }
    handleLiveStatus(bytes) {
        if (bytes[3] !== 1)
            return;
        let rawState;
        let percent;
        let profile;
        let activeDpiStage;
        let reportRateIndex;
        if (this.protocol === "dms" &&
            (bytes[0] === 1 || bytes[0] === 65) &&
            bytes[2] === 142) {
            rawState = bytes[5];
            percent = bytes[6];
            profile = bytes[7];
            activeDpiStage = bytes[8];
            reportRateIndex = bytes[9] > 0 ? bytes[9] - 1 : bytes[9];
        }
        else if (this.protocol === "dms_v2" &&
            (bytes[0] === 1 || bytes[0] === 65) &&
            (bytes[2] === 152 || bytes[2] === 153)) {
            rawState = bytes[10];
            percent = bytes[11];
            profile = bytes[12];
            activeDpiStage = bytes[13];
            reportRateIndex = bytes[20] > 0 ? bytes[20] - 1 : bytes[20];
        }
        if (rawState === undefined || percent === undefined || profile === undefined)
            return;
        const power = {
            state: this.protocol === "dms_v2" && rawState === 3 ? 0 : rawState,
            percent: clamp(percent, 0, 100),
            profile: clamp(profile, 0, ORBITAL_PROFILE_COUNT - 1),
        };
        if (this.settings) {
            this.settings.power = power;
            if (activeDpiStage !== undefined && activeDpiStage >= 0 && activeDpiStage < 5) {
                this.settings.activeDpiStage = activeDpiStage;
            }
            if (reportRateIndex !== undefined &&
                reportRateIndex >= 0 &&
                reportRateIndex < ORBITAL_REPORT_RATES_HZ.length) {
                this.settings.reportRateIndex = reportRateIndex;
                this.settings.reportRateHz = ORBITAL_REPORT_RATES_HZ[reportRateIndex];
            }
        }
        const update = { power, activeDpiStage, reportRateIndex };
        for (const listener of this.updateListeners)
            listener(update);
    }
    makePacket() {
        return new Uint8Array(ORBITAL_PACKET_SIZE);
    }
    packetWith(...pairs) {
        const packet = this.makePacket();
        for (const [offset, value] of pairs)
            packet[offset] = value;
        return this.finishPacket(packet);
    }
    /**
     * Applies receiver routing and the checksum in the required order.
     * Do not calculate the checksum first and set 0x40 afterward; that produces a
     * packet the receiver will reject.
     */
    finishPacket(packet, routeToMouse = true) {
        // The receiver uses bit 6 of byte 0 as "send this to the paired mouse".
        // Set it before the checksum or the receiver will reject the packet.
        if (this.isReceiver && routeToMouse)
            packet[0] |= 0x40;
        let sum = 0;
        for (let index = 0; index < 63; index += 1)
            sum += packet[index];
        packet[63] = (161 - (sum & 0xff)) & 0xff;
        return packet;
    }
    async sendPacket(packet, label) {
        if (!this.device.opened)
            throw new Error("Orbital device is not open.");
        this.logger(`OUT report 0x${ORBITAL_REPORT_ID.toString(16).padStart(2, "0")} - ${label}`, packet);
        await this.device.sendReport(ORBITAL_REPORT_ID, packet);
    }
    async requestResponse(packet, predicate, label, timeoutMs = this.timeoutMs) {
        // Register the waiter first. Some devices answer quickly enough that doing this
        // after sendReport creates a tiny race and misses the reply.
        const response = this.waitForReport(predicate, timeoutMs);
        await this.sendPacket(packet, label);
        return response;
    }
    waitForReport(predicate, timeoutMs) {
        return new Promise((resolve, reject) => {
            const waiter = {
                predicate,
                resolve,
                reject,
                timer: setTimeout(() => {
                    this.waiters.delete(waiter);
                    reject(new Error("Timed out waiting for the Orbital response."));
                }, timeoutMs),
            };
            this.waiters.add(waiter);
        });
    }
    async saveSettings(timeoutMs = this.timeoutMs) {
        const packet = this.packetWith([0, 10], [2, 129], [3, 1]);
        await this.requestResponse(packet, (bytes) => bytes[0] === 10 || bytes[0] === 74, "save settings", timeoutMs);
    }
    rejectAllWaiters(error) {
        for (const waiter of this.waiters) {
            clearTimeout(waiter.timer);
            waiter.reject(error);
        }
        this.waiters.clear();
    }
}
// -----------------------------------------------------------------------------
// Helpers kept outside the class so they are easy to reuse in another transport
// -----------------------------------------------------------------------------
function hasOrbitalConfigCollection(device) {
    return Boolean(device.collections?.some((collection) => collection.usage === 1 && collection.usagePage === 0xff0a));
}
function reportRateIndexToHz(index) {
    return ORBITAL_REPORT_RATES_HZ[clamp(index, 0, ORBITAL_REPORT_RATES_HZ.length - 1)];
}
function reportRateHzToIndex(hz) {
    const exact = ORBITAL_REPORT_RATES_HZ.indexOf(hz);
    if (exact >= 0)
        return exact;
    // Handy for a generic UI: pick the closest supported rate instead of throwing.
    return ORBITAL_REPORT_RATES_HZ.reduce((best, rate, index) => Math.abs(rate - hz) < Math.abs(ORBITAL_REPORT_RATES_HZ[best] - hz) ? index : best, 0);
}
function powerStateLabel(power) {
    if (power.state === 2)
        return "fully charged";
    if (power.state === 1 || power.state === 3)
        return "charging";
    return "on battery";
}
function normalizeDpiStages(input) {
    const fallback = [
        [400, 400],
        [800, 800],
        [1600, 1600],
        [3200, 3200],
        [4800, 4800],
    ];
    return Array.from({ length: 5 }, (_, index) => {
        const pair = input[index] ?? fallback[index];
        return [normalizeDpi(pair[0]), normalizeDpi(pair[1])];
    });
}
function normalizeDpi(value) {
    const stepped = Math.round(Number(value) / ORBITAL_DPI_LIMITS.step) * ORBITAL_DPI_LIMITS.step;
    return clamp(stepped, ORBITAL_DPI_LIMITS.min, ORBITAL_DPI_LIMITS.max);
}
function encodeReportRate(index) {
    return index > 0 ? index + 1 : 0;
}
function signedByte(value) {
    return value <= 30 ? value : value - 256;
}
function countSetBits(value) {
    let count = 0;
    for (let byte = value; byte; byte >>>= 1)
        count += byte & 1;
    return count;
}
function readU16LE(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
}
function writeU16LE(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
}
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value)));
}
function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
function toHex4(value) {
    return value.toString(16).padStart(4, "0").toUpperCase();
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error ?? "");
}

// One object works in Electron/CommonJS and as a normal browser script.
const OrbitalHostProtocol = Object.freeze({
    ORBITAL_VENDOR_ID,
    ORBITAL_REPORT_ID,
    ORBITAL_PACKET_SIZE,
    ORBITAL_PROFILE_COUNT,
    ORBITAL_DPI_LIMITS,
    ORBITAL_REPORT_RATES_HZ,
    ORBITAL_DEVICES,
    OrbitalMouseClient,
    hasOrbitalConfigCollection,
    reportRateIndexToHz,
    reportRateHzToIndex,
    powerStateLabel,
    normalizeDpiStages,
    normalizeDpi,
});

if (typeof module !== "undefined" && module.exports) {
    module.exports = OrbitalHostProtocol;
}

if (typeof globalThis !== "undefined") {
    globalThis.OrbitalHostProtocol = OrbitalHostProtocol;
}
