// ==UserScript==
// @id             iitc-plugin-collocated-portals@57Cell
// @name           IITC plugin: Collocated Portals
// @category       Info
// @version        0.0.1.20101012.21732
// @namespace      https://github.com/jonatkins/ingress-intel-total-conversion
// @updateURL      https://github.com/mike40033/iitc-57Cell/raw/master/plugins/collocated-portals/collocated-portals.meta.js
// @downloadURL    https://github.com/mike40033/iitc-57Cell/raw/master/plugins/collocated-portals/collocated-portals.user.js
// @description    Find collocated portals
// @include        https://*.ingress.com/intel*
// @include        http://*.ingress.com/intel*
// @match          https://*.ingress.com/intel*
// @match          http://*.ingress.com/intel*
// @include        https://*.ingress.com/collcation/*
// @include        http://*.ingress.com/mission/*
// @match          https://*.ingress.com/mission/*
// @match          http://*.ingress.com/mission/*
// @grant          none
// ==/UserScript==


function wrapper(plugin_info) {
// ensure plugin framework is there, even if iitc is not yet loaded
if(typeof window.plugin !== 'function') window.plugin = function() {};

// PLUGIN START ////////////////////////////////////////////////////////


var timeToRemaining = function(t) {
var data = parseInt(t / 86400) + 'd ' + (new Date(t % 86400 * 1000)).toUTCString().replace(/.*(\d{2}):(\d{2}):(\d{2}).*/, '$1h $2m $3s');
data = data.replace('0d', '');
data = data.replace('00h', '');
data = data.replace('00m', '');
return data.trim();
};
window.plugin.collocated = {

    collocated_COLOR: '#ffffff',
    STRAIGHT_LINE_COLOR: '#ffff00',

    SYNC_DELAY: 5000,
    enableSync: false,



getPortalCache: function(guid) {
  if (this.cacheByPortalGuid[guid]) {
    return this.cacheByPortalGuid[guid].data;
  }
  return null;
},

storeCache: function() {
  this.checkCacheSize();
  localStorage['plugins-collocated-portalcache'] = JSON.stringify(this.cacheByPortalGuid);
},

storeLocal: function(key) {
  localStorage['plugins-collocated-' + key] = JSON.stringify(this[key]);
},

loadData: function() {
  this.cacheByPortalGuid = JSON.parse(localStorage['plugins-collocated-portalcache'] || '{}');
  if('plugins-collocated-settings' in localStorage) {
    var settings = JSON.parse(localStorage['plugins-collocated-settings'] || '{}');
    delete localStorage['plugins-missions-settings'];
  }
},

loadLocal: function(key) {
  this[key] = JSON.parse(localStorage['plugins-collocated-' + key] || '{}');
},

checkCacheSize: function() {
  if (JSON.stringify(this.cacheByPortalGuid).length > 1e6) { // 1 MB not MiB ;)
    this.cleanupPortalCache();
  }
  if (JSON.stringify(this.cacheByMissionGuid).length > 2e6) { // 2 MB not MiB ;)
    this.cleanupMissionCache();
 }
},

// Cleanup oldest half of the data.
cleanupPortalCache: function() {
  var me = this;
  var cache = Object.keys(this.cacheByPortalGuid);
  cache.sort(function(a, b) {
    return me.cacheByPortalGuid[a].time - me.cacheByPortalGuid[b].time;
  });
  var toDelete = (cache.length / 2) | 0;
  cache.splice(0, toDelete + 1).forEach(function(el) {
    delete me.cacheByPortalGuid[el];
  });
},

    onPortalChanged: function(type, guid, oldval) {
        var portal;
        if (type === 'add' || type === 'update') {
            // Compatibility
            portal = window.portals[guid] || oldval;
            var hasTwin = false;
            for (var otherID in window.portals) {
                if (guid === otherID) continue;
                var otherPortal = window.portals[otherID];
                if (portal.options.data.latE6 === otherPortal.options.data.latE6 && portal.options.data.lngE6 === otherPortal.options.data.lngE6) {
                    hasTwin = true;
//                } else {
//                    if ((portal.options.data.latE6 === 0 && otherPortal.options.data.latE6 === 0)
//                        || (portal.options.data.lngE6 === otherPortal.options.data.lngE6)) {
//                        partnerIDs.push(otherID);
//                    }
                }

            }
            if (!hasTwin) {
                return;
            }
            if (hasTwin && !this.markedStarterPortals[guid]) {
                this.markedStarterPortals[guid] = L.circleMarker(
                    L.latLng(portal.options.data.latE6 / 1E6, portal.options.data.lngE6 / 1E6), {
                        radius: portal.options.radius + Math.ceil(portal.options.radius),
                        weight: 3,
                        opacity: 1,
                        color: window.plugin.collocated.collocated_COLOR,
                        fill: true,
                        dashArray: null,
                        clickable: false
                    }
                );
                this.collocatedPortalsLayer.addLayer(this.markedStarterPortals[guid]);
            }

        } else if (type === 'delete') {
            portal = oldval;
            if (!this.markedStarterPortals[guid]) {
                return;
            }

            this.collocatedPortalsLayer.removeLayer(this.markedStarterPortals[guid]);
            delete this.markedStarterPortals[guid];
        }
    },

    onPaneChanged: function(pane) {
        if(pane == 'plugin-collocated') {
            document.body.appendChild(this.mobilePane);
        } else if(this.mobilePane.parentNode) {
            this.mobilePane.parentNode.removeChild(this.mobilePane);
        }
    },

    setup: function() {
        this.cacheByPortalGuid = {};
        this.markedStarterPortals = {};

        this.loadData();

        /*
        I know iitc has portalAdded event but it is missing portalDeleted. So we have to resort to Object.observe
         */
        var me = this;
        if (Object.observe) { // Chrome
            Object.observe(window.portals, function(changes) {
                changes.forEach(function(change) {
                    me.onPortalChanged(change.type, change.name, change.oldValue);
                });
            });
        } else { // Firefox why no Object.observer ? :<
            window.addHook('portalAdded', function(data) {
                me.onPortalChanged('add', data.portal.options.guid, data.portal);
            });
            // TODO: bug iitc dev for portalRemoved event
            var oldDeletePortal = window.Render.prototype.deletePortalEntity;
            window.Render.prototype.deletePortalEntity = function(guid) {
                if (guid in window.portals) {
                    me.onPortalChanged('delete', guid, window.portals[guid]);
                }
                oldDeletePortal.apply(this, arguments);
            };
        }

        this.collocatedPortalsLayer = new L.LayerGroup();

        window.addLayerGroup('collocated portals', this.collocatedPortalsLayer, false);

    }
};

    var setup = window.plugin.collocated.setup.bind(window.plugin.collocated);

    // PLUGIN END //////////////////////////////////////////////////////////


    setup.info = plugin_info; //add the script info data to the function as a property
    if(!window.bootPlugins) window.bootPlugins = [];
    window.bootPlugins.push(setup);
    // if IITC has already booted, immediately run the 'setup' function
    if(window.iitcLoaded && typeof setup === 'function') setup();
} // wrapper end
// inject code into site context
var script = document.createElement('script');
var info = {};
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) info.script = { version: GM_info.script.version, name: GM_info.script.name, description: GM_info.script.description };
script.appendChild(document.createTextNode('('+ wrapper +')('+JSON.stringify(info)+');'));
(document.body || document.head || document.documentElement).appendChild(script);


