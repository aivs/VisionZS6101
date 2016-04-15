/*** VisionZS6101 Z-Way HA module *******************************************

Version: 1.0
(c) Z-Wave.Me, 2016
-----------------------------------------------------------------------------
Author: Yurkin Vitaliy   <aivs@z-wave.me>
    based on the VisionZS6101 from Maroš Kollár <maros@k-1.com> which based on the PhilioHW module from Poltorak Serguei <ps@z-wave.me>
Description:
    Full support for the VisionZS6101 V3.5 Smoke Detector
    
******************************************************************************/

// ----------------------------------------------------------------------------
// --- Class definition, inheritance and setup
// ----------------------------------------------------------------------------

function VisionZS6101 (id, controller) {
    // Call superconstructor first (AutomationModule)
    VisionZS6101.super_.call(this, id, controller);
    
    this.langFile               = undefined;
    this.commandClass           = 0x71;
    this.manufacturerId         = 0x0109;
    this.manufacturerProductId  = 0x0403;
    this.applicationMajor       = 0x3;
    this.applicationMinor       = 0x5;
    
    this.devicesSecondary       = {};
    this.devicesTamper          = {};
    this.bindings               = [];
    this.timeouts               = {};
}

inherits(VisionZS6101, AutomationModule);

_module = VisionZS6101;

// ----------------------------------------------------------------------------
// --- Module instance initialized
// ----------------------------------------------------------------------------

VisionZS6101.prototype.init = function(config) {
    VisionZS6101.super_.prototype.init.call(this, config);
    
    var self = this;
    
    self.langFile   = self.controller.loadModuleLang("VisionZS6101");
    self.zwayReg = function (zwayName) {
        var zway = global.ZWave && global.ZWave[zwayName].zway;
        if (!zway) {
            return;
        }
        
        // Loop all devices 
        for(var deviceIndex in zway.devices) {
            var device = zway.devices[deviceIndex];
            
            // Get manufacturer and product id
            if (typeof(device) !== 'undefined'
                && device.data.manufacturerId.value == self.manufacturerId
                && device.data.manufacturerProductId.value == self.manufacturerProductId
                && device.data.applicationMajor.value == self.applicationMajor
                && device.data.applicationMinor.value == self.applicationMinor) {
                
                if (typeof(device.instances[0].commandClasses[self.commandClass.toString()]) !== 'undefined') {
                    self.handleDevice(zway,device);
                }
            }
        }
    };
    
    self.zwayUnreg = function(zwayName) {
        // detach handlers
        if (self.bindings[zwayName]) {
            self.controller.emit("ZWave.dataUnbind", self.bindings[zwayName]);
        }
        self.bindings[zwayName] = null;
    };
    
    self.controller.on("ZWave.register", self.zwayReg);
    self.controller.on("ZWave.unregister", self.zwayUnreg);
    
    // walk through existing ZWave
    if (global.ZWave) {
        for (var name in global.ZWave) {
            this.zwayReg(name);
        }
    }
};

VisionZS6101.prototype.stop = function () {
    var self = this;
    
    // unsign event handlers
    this.controller.off("ZWave.register", this.zwayReg);
    this.controller.off("ZWave.unregister", this.zwayUnreg);
    
    _.each(self.devicesSecondary,function(deviceId,vDev) {
        self.controller.devices.remove(deviceId);
    });
    _.each(self.devicesTamper,function(deviceId,vDev) {
        self.controller.devices.remove(deviceId);
    });
    
    _.each(self.bindings,function(binding) {
        binding.data.unbind(binding.func);
    });
    
    this.zwayReg            = undefined;
    this.zwayUnreg          = undefined;
    this.bindings           = [];
    this.devicesTamper      = {};
    this.devicesSecondary   = {};
    this.timeouts           = {};
    
    VisionZS6101.super_.prototype.stop.call(this);
};

// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------

VisionZS6101.prototype.checkDevice = function(device) {
    var self = this;
    
    var dataHolder  = device.instances[0].commandClasses[self.commandClass].data;
    var alarmType   = dataHolder.V1event.alarmType.value;
    if (alarmType === null) return;

    var alarmSource = dataHolder[alarmType].event.value;
    var alarmLevel  = dataHolder.V1event.level.value === 0 ? "off" : "on";
    if (alarmSource === 2) {
        self.devicesSecondary[device.id].set("metrics:level", alarmLevel);
    } else if (alarmSource === 254 && self.devicesTamper[device.id]) {
        var tamperDevice = self.devicesTamper[device.id];
        tamperDevice.set("metrics:level", alarmLevel);
        if (alarmLevel === 'on') {
            tamperDevice.set("metrics:offTime",Math.floor(new Date().getTime() / 1000)+ self.config.tamperReset);
            if (typeof(self.timeouts[device.id]) !== 'undefined') {
                clearTimeout(self.timeouts[device.id]);
            }
            self.timeouts[device.id] = setTimeout(function() {
                self.timeouts[device.id] = undefined;
                tamperDevice.set("metrics:level", 'off');
                tamperDevice.set("metrics:offTime",null);
            },1000*self.config.tamperReset);
        }
    }
};

VisionZS6101.prototype.handleDevice = function(zway,device) {
    var self = this;
    
    var title               = device.data.givenName.value;
    var vDevSecondaryId     = 'VisionZS6101_' + device.id;
    var vDevTamperId        = 'VisionZS6101_' + device.id+'_tamper';
    var deviceSecondaryObject;
    var deviceTamperObject;
    
    if (! self.controller.devices.get(vDevSecondaryId)) {        
        deviceSecondaryObject = self.addDevice(vDevSecondaryId,{
            probeType: "general_purpose",
            metrics: {
                icon: 'alarm',
                title: self.langFile.device_smoke_detector+' '+title
            }
        });
        if (deviceSecondaryObject) {
            self.devicesSecondary[device.id] = deviceSecondaryObject;
        }
    }
    
    if (! self.controller.devices.get(vDevTamperId)) {        
        deviceTamperObject = self.addDevice(vDevTamperId,{
            probeType: "alarm_burglar",
            metrics: {
                icon: 'alarm',
                title: self.langFile.device_tamper+' '+title
            }
        });
        
        if (deviceTamperObject) {
            self.devicesTamper[device.id] = deviceTamperObject;
            if (deviceTamperObject.get('metrics:level') === 'on') {
                deviceTamperObject.set('metrics:level','off');
            }
        }
    }
    
    if (deviceSecondaryObject || deviceTamperObject) {
        var dataHolder      = device.instances[0].commandClasses[self.commandClass].data;
        var dataHolderEvent = dataHolder.V1event;
        
        self.bindings.push({
            data:       dataHolderEvent,
            func:       dataHolderEvent.bind(function(type) {
                self.checkDevice(device);
            })
        });
        self.checkDevice(device);
    }
};

VisionZS6101.prototype.addDevice = function(vDevId,defaults) {
    var self = this;
    
    defaults.metrics = _.extend(defaults.metrics,{
        probeTitle:"General purpose",
        scaleTitle: '',
        level: 'off'
    });
    
    return self.controller.devices.create({
        deviceId: vDevId,
        defaults: defaults,
        overlay: {
            visibility: (_.indexOf(self.config.banned,vDevId) === -1 ? true:false),
            deviceType: 'sensorBinary'
        },
        moduleId: self.id
    });
};
