// ==UserScript==
// @id             iitc-plugin-battle-beacon-countdown@57Cell
// @name           IITC Plugin: 57Cell's Battle Beacon Countdown
// @version        0.1.0.20261006
// @description    Highlights portals with a scan-scheduled Rare Battle Beacon and counts down to the end of the septicycle, when it will appear
// @author         57Cell (Michael Hartley) and Claude.AI
// @category       Highlighter
// @namespace      https://github.com/jonatkins/ingress-intel-total-conversion
// @updateURL      https://github.com/mike40033/iitc-57Cell/raw/master/plugins/battle-beacon-countdown/battle-beacon-countdown.meta.js
// @downloadURL    https://github.com/mike40033/iitc-57Cell/raw/master/plugins/battle-beacon-countdown/battle-beacon-countdown.user.js
// @include        https://intel.ingress.com/*
// @include        http://intel.ingress.com/*
// @match          https://intel.ingress.com/*
// @match          http://intel.ingress.com/*
// @include        https://*.ingress.com/intel*
// @include        http://*.ingress.com/intel*
// @match          https://*.ingress.com/intel*
// @match          http://*.ingress.com/intel*
// @grant          none
// ==/UserScript==

pluginName = "57Cell's Battle Beacon Countdown";
version = "0.1.0";
changeLog = [
    {
        version: '0.1.0.20261006',
        changes: [
            'Initial release',
        ],
    },
];

function wrapper(plugin_info) {
    if (typeof window.plugin !== 'function') window.plugin = function() {};

    plugin_info.buildName = '';
    plugin_info.dateTimeVersion = '20261006';
    plugin_info.pluginId = 'battle-beacon-countdown';

    // When a portal gets 7 scan-meter uploads within a septicycle, Ingress schedules a
    // Rare Battle Beacon for it, to be deployed after the septicycle ends. Intel shows the
    // scheduled beacon as the ornament 'bb_s' in the portal's summary data. We can't see
    // scan counts below 7, so portals only show up here once their beacon is scheduled.

    var self = window.plugin.battleBeaconCountdown = function() {};

    // Ornament IDs that mean "a battle beacon is scheduled here". Case-insensitive prefix match,
    // so variants like 'bb_s_xyz' are caught too.
    self.SCHEDULED_ORNAMENT_PREFIXES = ['bb_s'];

    // Septicycles are 175 hours long, counted from the unix epoch (same maths as IITC's score-cycle-times).
    self.CHECKPOINT = 5 * 60 * 60 * 1000;
    self.CYCLE = 35 * self.CHECKPOINT;

    self.STORAGE_KEY = 'plugin-battle-beacon-countdown-seen';
    self.HIGHLIGHT_COLOR = '#ff2a6d';
    self.LABEL_MIN_ZOOM = 14;

    self.markers = {};   // guid -> {ring, label}
    self.seen = {};      // guid -> {title, lat, lng, cycleEnd, lastSeen}
    self.ornamentIdsInView = {};

    self.cycleEnd = function(now) {
        now = now || Date.now();
        return (Math.floor(now / self.CYCLE) + 1) * self.CYCLE;
    };

    self.formatRemaining = function(ms) {
        if (ms <= 0) return 'due now';
        var s = Math.floor(ms / 1000);
        var d = Math.floor(s / 86400);
        var h = Math.floor(s % 86400 / 3600);
        var m = Math.floor(s % 3600 / 60);
        var sec = s % 60;
        var pad = function(n) { return (n < 10 ? '0' : '') + n; };
        return (d > 0 ? d + 'd ' : '') + pad(h) + 'h ' + pad(m) + 'm ' + pad(sec) + 's';
    };

    self.formatTime = function(t) {
        return new Date(t).toLocaleString(undefined, {
            weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });
    };

    self.escapeHtml = function(s) {
        return String(s).replace(/[&<>"']/g, function(c) {
            return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
        });
    };

    self.isScheduledOrnament = function(id) {
        if (typeof id !== 'string') return false;
        var lower = id.toLowerCase();
        return self.SCHEDULED_ORNAMENT_PREFIXES.some(function(p) { return lower.indexOf(p) === 0; });
    };

    self.hasScheduledBeacon = function(portal) {
        var ornaments = portal && portal.options && portal.options.data && portal.options.data.ornaments;
        return Array.isArray(ornaments) && ornaments.some(self.isScheduledOrnament);
    };

    // ---- persistence of beacons seen this septicycle, so the list survives panning away ----

    self.loadSeen = function() {
        try {
            self.seen = JSON.parse(localStorage[self.STORAGE_KEY] || '{}');
        } catch (e) {
            self.seen = {};
        }
        self.pruneSeen();
    };

    self.saveSeen = function() {
        try {
            localStorage[self.STORAGE_KEY] = JSON.stringify(self.seen);
        } catch (e) {
            // storage full or unavailable: the list just won't persist
        }
    };

    // Forget beacons whose septicycle ended more than a day ago (they've appeared by now).
    self.pruneSeen = function() {
        var cutoff = Date.now() - 24 * 60 * 60 * 1000;
        Object.keys(self.seen).forEach(function(guid) {
            if (self.seen[guid].cycleEnd < cutoff) delete self.seen[guid];
        });
    };

    // ---- map layer ----

    self.addMarker = function(guid, portal) {
        var latLng = portal.getLatLng();
        var ring = L.circleMarker(latLng, {
            radius: 18,
            color: self.HIGHLIGHT_COLOR,
            weight: 4,
            opacity: 0.9,
            fill: false,
            dashArray: '6,4',
            interactive: false
        });
        var label = L.marker(latLng, {
            icon: L.divIcon({
                className: 'bbc-label',
                iconSize: [110, 16],
                iconAnchor: [55, -20],
                html: '<span class="bbc-label-text"></span>'
            }),
            interactive: false,
            keyboard: false
        });
        self.markers[guid] = {ring: ring, label: label};
        self.layer.addLayer(ring);
        if (window.map.getZoom() >= self.LABEL_MIN_ZOOM) self.layer.addLayer(label);
    };

    self.removeMarker = function(guid) {
        var m = self.markers[guid];
        if (!m) return;
        self.layer.removeLayer(m.ring);
        self.layer.removeLayer(m.label);
        delete self.markers[guid];
    };

    self.scanPortals = function() {
        var now = Date.now();
        var cycleEnd = self.cycleEnd(now);
        var found = {};
        var ornamentIds = {};
        var changed = false;

        $.each(window.portals, function(guid, portal) {
            var ornaments = portal.options.data && portal.options.data.ornaments;
            if (Array.isArray(ornaments)) {
                ornaments.forEach(function(id) { ornamentIds[id] = (ornamentIds[id] || 0) + 1; });
            }
            if (!self.hasScheduledBeacon(portal)) return;
            found[guid] = true;
            if (!self.markers[guid]) self.addMarker(guid, portal);
            var ll = portal.getLatLng();
            var prev = self.seen[guid];
            var title = portal.options.data.title || (prev && prev.title) || '(unnamed portal)';
            if (!prev || prev.cycleEnd !== cycleEnd || prev.title !== title) changed = true;
            self.seen[guid] = {title: title, lat: ll.lat, lng: ll.lng, cycleEnd: cycleEnd, lastSeen: now};
        });

        // Remove highlights for portals no longer loaded, or whose ornament has gone.
        Object.keys(self.markers).forEach(function(guid) {
            if (!found[guid]) self.removeMarker(guid);
        });

        // A remembered portal that is loaded but no longer carries the ornament was cancelled or has fired.
        Object.keys(self.seen).forEach(function(guid) {
            if (window.portals[guid] && !found[guid] && self.seen[guid].cycleEnd === cycleEnd) {
                delete self.seen[guid];
                changed = true;
            }
        });

        self.ornamentIdsInView = ornamentIds;
        if (changed) self.saveSeen();
        self.tick();
    };

    self.updateLabelVisibility = function() {
        var show = window.map.getZoom() >= self.LABEL_MIN_ZOOM;
        $.each(self.markers, function(guid, m) {
            if (show) self.layer.addLayer(m.label);
            else self.layer.removeLayer(m.label);
        });
    };

    // ---- countdown display ----

    self.tick = function() {
        var now = Date.now();
        var end = self.cycleEnd(now);
        var remaining = self.formatRemaining(end - now);
        var inView = Object.keys(self.markers).length;

        $('.bbc-label-text').text(remaining);

        if (self.statusEl) {
            self.statusEl.innerHTML =
                '<div class="bbc-status-title">Battle beacons</div>' +
                '<div>' + inView + ' scheduled in view</div>' +
                '<div>Septicycle ends in <b>' + remaining + '</b></div>';
        }

        if (self.dialogOpen) self.renderDialog();
    };

    self.renderDialog = function() {
        var now = Date.now();
        var end = self.cycleEnd(now);
        var guids = Object.keys(self.seen).filter(function(g) { return self.seen[g].cycleEnd >= end - self.CYCLE; });
        guids.sort(function(a, b) {
            return self.seen[a].cycleEnd - self.seen[b].cycleEnd ||
                self.seen[a].title.localeCompare(self.seen[b].title);
        });

        var html = '<p>Septicycle ends <b>' + self.escapeHtml(self.formatTime(end)) + '</b> ' +
            '(in ' + self.formatRemaining(end - now) + '). Scheduled beacons are deployed after that.</p>';

        if (guids.length === 0) {
            html += '<p><i>No scheduled battle beacons seen yet this septicycle.</i></p>';
        } else {
            html += '<table class="bbc-table"><tr><th>Portal</th><th>Appears in</th></tr>';
            guids.forEach(function(guid) {
                var s = self.seen[guid];
                var loaded = !!self.markers[guid];
                html += '<tr><td><a class="bbc-portal" data-guid="' + self.escapeHtml(guid) + '"' +
                    ' data-lat="' + s.lat + '" data-lng="' + s.lng + '">' + self.escapeHtml(s.title) + '</a>' +
                    (loaded ? '' : ' <span class="bbc-dim" title="Not currently loaded on the map">(off map)</span>') +
                    '</td><td>' + self.formatRemaining(s.cycleEnd - now) + '</td></tr>';
            });
            html += '</table>';
        }

        html += '<p class="bbc-dim">Only portals that reach 7 scans are marked by Intel, so portals still short of 7 ' +
            'can\'t be shown. Zoom in far enough for all portals to load (zoom 15+) to be sure of catching every one.</p>';

        var ids = Object.keys(self.ornamentIdsInView).sort();
        html += '<details><summary class="bbc-dim">Ornament IDs on loaded portals (' + ids.length + ')</summary>' +
            '<div class="bbc-dim">' + (ids.length ? ids.map(function(id) {
                return self.escapeHtml(id) + ' &times;' + self.ornamentIdsInView[id];
            }).join('<br>') : 'none') + '</div>' +
            '<div class="bbc-dim">Looking for: ' + self.escapeHtml(self.SCHEDULED_ORNAMENT_PREFIXES.join(', ')) + '*</div></details>';

        var container = $('#bbc-dialog-content');
        // Keep the debug section open/closed across refreshes.
        var detailsOpen = container.find('details').prop('open');
        container.html(html);
        if (detailsOpen) container.find('details').prop('open', true);
    };

    self.showDialog = function() {
        self.dialogOpen = true;
        window.dialog({
            title: 'Scheduled Battle Beacons',
            html: '<div id="bbc-dialog-content"></div>',
            id: 'plugin-battle-beacon-countdown',
            width: 380,
            closeCallback: function() { self.dialogOpen = false; }
        });
        self.renderDialog();
    };

    self.setupUI = function() {
        $('<style>').prop('type', 'text/css').html(
            '.bbc-label { pointer-events: none; }' +
            '.bbc-label-text { display: block; text-align: center; font-size: 11px; font-weight: bold; color: #fff;' +
            ' background: rgba(0,0,0,0.65); border: 1px solid ' + self.HIGHLIGHT_COLOR + '; border-radius: 3px;' +
            ' white-space: nowrap; }' +
            '.bbc-status { background: rgba(8,48,78,0.9); color: #ffce00; padding: 4px 8px; border-radius: 4px;' +
            ' font-size: 12px; line-height: 1.4; cursor: pointer; }' +
            '.bbc-status-title { color: ' + self.HIGHLIGHT_COLOR + '; font-weight: bold; }' +
            '.bbc-table { width: 100%; border-collapse: collapse; }' +
            '.bbc-table th, .bbc-table td { text-align: left; padding: 2px 4px; }' +
            '.bbc-table td:last-child { white-space: nowrap; }' +
            '.bbc-portal { cursor: pointer; }' +
            '.bbc-dim { opacity: 0.7; font-size: 11px; }'
        ).appendTo('head');

        var StatusControl = L.Control.extend({
            options: {position: 'bottomleft'},
            onAdd: function() {
                var el = L.DomUtil.create('div', 'bbc-status leaflet-control');
                el.title = 'Click for the list of scheduled battle beacons';
                L.DomEvent.disableClickPropagation(el);
                L.DomEvent.on(el, 'click', self.showDialog);
                self.statusEl = el;
                return el;
            },
            onRemove: function() { self.statusEl = null; }
        });
        self.statusControl = new StatusControl();

        // Show the countdown box only while the layer is enabled.
        window.map.on('layeradd', function(e) {
            if (e.layer === self.layer) { self.statusControl.addTo(window.map); self.tick(); }
        });
        window.map.on('layerremove', function(e) {
            if (e.layer === self.layer) self.statusControl.remove();
        });
        if (window.map.hasLayer(self.layer)) self.statusControl.addTo(window.map);

        $('#toolbox').append('<a onclick="window.plugin.battleBeaconCountdown.showDialog(); return false;"' +
            ' title="List portals with scheduled battle beacons">Battle Beacons</a>');

        $(document).on('click', '#bbc-dialog-content .bbc-portal', function() {
            var guid = $(this).data('guid');
            var latLng = [parseFloat($(this).data('lat')), parseFloat($(this).data('lng'))];
            if (window.portals[guid]) {
                window.renderPortalDetails(guid);
                window.map.setView(latLng, Math.max(window.map.getZoom(), 15));
            } else if (window.zoomToAndShowPortal) {
                window.zoomToAndShowPortal(guid, latLng);
            } else {
                window.map.setView(latLng, 17);
            }
        });
    };

    var setup = function() {
        self.layer = new L.LayerGroup();
        window.addLayerGroup('Scheduled Battle Beacons', self.layer, true);

        self.loadSeen();
        self.setupUI();

        window.addHook('mapDataRefreshEnd', self.scanPortals);
        window.addHook('portalDetailLoaded', self.scanPortals);
        window.map.on('zoomend', self.updateLabelVisibility);

        setInterval(self.tick, 1000);
        // Prune once an hour so last septicycle's list clears without a reload.
        setInterval(function() { self.pruneSeen(); self.saveSeen(); }, 60 * 60 * 1000);

        self.scanPortals();
    };

    setup.info = plugin_info;
    if (!window.bootPlugins) window.bootPlugins = [];
    window.bootPlugins.push(setup);
    if (window.iitcLoaded && typeof setup === 'function') setup();
}

var script = document.createElement('script');
var info = {};
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) info.script = { version: GM_info.script.version, name: GM_info.script.name, description: GM_info.script.description };
script.appendChild(document.createTextNode('('+ wrapper +')('+JSON.stringify(info)+');'));
(document.body || document.head || document.documentElement).appendChild(script);
