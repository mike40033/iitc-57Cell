// ==UserScript==
// @id             iitc-plugin-collocated-portals@57Cell
// @name           IITC plugin: Collocated Portals
// @category       Info
// @version        0.2.0.20200306.091215
// @namespace      https://github.com/jonatkins/ingress-intel-total-conversion
// @updateURL      https://github.com/mike40033/iitc-57Cell/raw/master/plugins/collocated-portals/collocated-portals.meta.js
// @downloadURL    https://github.com/mike40033/iitc-57Cell/raw/master/plugins/collocated-portals/collocated-portals.user.js
// @description    Find collocated portals
// @include        https://*.ingress.com/intel*
// @include        http://*.ingress.com/intel*
// @match          https://*.ingress.com/intel*
// @match          http://*.ingress.com/intel*
// @include        https://*.ingress.com/*
// @include        http://*.ingress.com/*
// @match          https://*.ingress.com/*
// @match          http://*.ingress.com/*
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
    collocated_MULTI_COLOR: '#ffff00',
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
            var dupes = 0;
            var falseTwin = false;
            for (var otherID in window.portals) {
                if (guid === otherID) continue;
                var otherPortal = window.portals[otherID];
                if (portal.options.data.latE6 === otherPortal.options.data.latE6 && portal.options.data.lngE6 === otherPortal.options.data.lngE6) {
                    dupes++;
                } else if (portal.options.data.latE6 == -31950752 && portal.options.data.lngE6 == 115871288) {
                    dupes=1;
                    falseTwin = true;
                } else if (portal.options.data.latE6 == -31950837 && portal.options.data.lngE6 == 115871273) {
                    dupes=1;
                }
            }
            if (dupes == 0) {
                return;
            }
            if (dupes > 0 && !this.markedStarterPortals[guid]) {
                var marker = L.circleMarker(
                    L.latLng(portal.options.data.latE6 / 1E6, portal.options.data.lngE6 / 1E6), {
                        radius: dupes == 1 ? 25 : 35,
                        weight: 3,
                        opacity: 1,
                        color: dupes == 1 ? window.plugin.collocated.collocated_COLOR : window.plugin.collocated.collocated_MULTI_COLOR,
                        fill: true,
                        dashArray: null,
                        clickable: false
                    }
                );
                if (falseTwin) {
                    var div = new L.Icon({iconUrl: 'https://raw.githubusercontent.com/mike40033/iitc-57Cell/master/plugins/collocated-portals/PluginText.png',
                                         iconAnchor: [0,0],
                                      iconSize: [320,116],
                                         className: 'no-pointer-events'});

                    marker = new L.Marker(L.latLng(portal.options.data.latE6 / 1E6, portal.options.data.lngE6 / 1E6), {icon:div, clickable:false, keyboard:false, opacity:100});
                }
                this.markedStarterPortals[guid] = marker;
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

        window.addLayerGroup('Collocated Portals', this.collocatedPortalsLayer, false);

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


