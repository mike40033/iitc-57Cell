// ==UserScript==
// @id             iitc-plugin-homogeneous-fields@57Cell
// @name           IITC Plugin: 57Cell's Link And Field Counter
// @version        0.4.0.20240803
// @description    Plugin for counting links and fields by agents
// @author         57Cell (Michael Hartley) and Claude.AI
// @category       Layer
// @namespace      https://github.com/jonatkins/ingress-intel-total-conversion
// @updateURL      https://github.com/mike40033/iitc-57Cell/raw/master/plugins/link-and-field-counter/link-and-field-counter.meta.js
// @downloadURL    https://github.com/mike40033/iitc-57Cell/raw/master/plugins/link-and-field-counter/link-and-field-counter.user.js
// @include        https://intel.ingress.com/*
// @include        http://intel.ingress.com/*
// @match          https://intel.ingress.com/*
// @match          http://intel.ingress.com/*
// @include        https://*.ingress.com/intel*
// @include        http://*.ingress.com/intel*
// @match          https://*.ingress.com/intel*
// @match          http://*.ingress.com/intel*
// @include        https://*.ingress.com/mission/*
// @include        http://*.ingress.com/mission/*
// @match          https://*.ingress.com/mission/*
// @match          http://*.ingress.com/mission/*
// @grant        none
// ==/UserScript==

pluginName = "57Cell's Link And Field Counter";
version = "0.4.0";
changeLog = [
    {
        version: '0.4.0.20240803',
        changes: [
            'Initial release',
        ],
    },
];


function wrapper(plugin_info) {
    if (typeof window.plugin !== 'function') window.plugin = function() {};

    plugin_info.buildName = '';
    plugin_info.dateTimeVersion = '2024-08-03-180000';
    plugin_info.pluginId = '57CellsLinkAndFieldCounter';
  
    window.plugin.agentLinkCounter = function() {};
    var self = window.plugin.agentLinkCounter;

    self.linkCounts = {};
    self.seenLinks = new Set();
    self.loadLinkCounts = function() {
        try {
            var savedData = localStorage.getItem('plugin-agent-link-counter');
            if (savedData !== null) {
                var data = JSON.parse(savedData);
                var version = data.version || 0;
                if (version < 20240804) {
                    self.linkCounts = {};
                    for (let agent in data.linkCounts) {
                        self.linkCounts[agent] = {
                            count: data.linkCounts[agent],
                            faction: 'Unknown',
                            fields: 0,
                            mus: 0
                        };
                    }
                } else if (version < 20240805) {
                    self.linkCounts = {};
                    for (let agent in data.linkCounts) {
                        self.linkCounts[agent] = {
                            count: data.linkCounts[agent].count,
                            faction: data.linkCounts[agent].faction,
                            fields: 0,
                            mus: 0
                        };
                    }
                } else {
                    self.linkCounts = data.linkCounts || {};
                }
                self.lastResetTime = data.lastResetTime || Date.now();
                self.seenLinks = version < 20240803 ? new Set() : new Set(data.seenLinks || []);
                self.isCountingEnabled = data.isCountingEnabled !== undefined ? data.isCountingEnabled : true;
            }
        } catch (e) {
            console.error("Error loading link count data:", e);
            self.linkCounts = {};
            self.seenLinks = new Set();
            self.lastResetTime = Date.now();
            self.isCountingEnabled = true;
        }
        self.updateCountingUI();
    };

    self.saveLinkCounts = function() {
        var dataToSave = {
            linkCounts: self.linkCounts,
            lastResetTime: self.lastResetTime,
            seenLinks: Array.from(self.seenLinks),
            isCountingEnabled : self.isCountingEnabled,
            version: 20240805
        };
        try {
            localStorage.setItem('plugin-agent-link-counter', JSON.stringify(dataToSave));
        } catch (e) {
            console.error("Error saving link count data", e);
        }
    };

    self.toggleCounting = function() {
        self.isCountingEnabled = !self.isCountingEnabled;
        self.saveLinkCounts();
        self.updateCountingUI();
    };

    self.updateCountingUI = function() {
        var toggleButton = $('#link-counter-toggle');
        if (self.isCountingEnabled) {
            toggleButton.text('Disable Counting');
        } else {
            toggleButton.text('Enable Counting');
        }
        self.updateInfoLabel();
    };

    self.updateCounter = function() {
        var content = '<table><tr><th>Agent</th><th>Links</th><th>Fields</th><th>MU</th></tr>';
        var sortedAgents = Object.keys(self.linkCounts).sort((a, b) => self.linkCounts[b].count - self.linkCounts[a].count);
        var totals = {
            Enlightened: [0,0,0],
            Resistance: [0,0,0],
            Machina: [0,0,0],
            Unknown: [0,0,0]
        };
        for (var agent of sortedAgents) {
            console.log(agent);
            var agentData = self.linkCounts[agent];
            if (agentData && agentData.count) {
                if (agent == 'Machina') {
                    totals[agent][0] += self.linkCounts[agent].count;
                    totals[agent][1] += self.linkCounts[agent].fields;
                    totals[agent][2] += self.linkCounts[agent].mus;
                } else {
                    var factionColor = agentData.faction === 'Enlightened' ? '#03DC03' :
                    agentData.faction === 'Resistance' ? '#00C5FF' :
                    agentData.faction === 'Machina' ? '#FF3300' : '#FFFFFF';
                    totals[agentData.faction][0] += agentData.count;
                    totals[agentData.faction][1] += agentData.fields;
                    totals[agentData.faction][2] += agentData.mus;
                    content += `<tr style="color: ${factionColor}">
                             <td>${agent}</td>
                             <td>${agentData.count}</td>
                             <td>${agentData.fields}</td>
                             <td>${agentData.mus}</td>
                             </tr>`;
                }
            }
        }
        let overallTotals = [0,0,0];
        for (let i=0; i<3; i++) {
            overallTotals[i] += totals.Enlightened[i];
            overallTotals[i] += totals.Resistance[i];
            overallTotals[i] += totals.Unknown[i];
        }
        content += `<tr></tr><tr><td><b>TOTAL</b></td>
                                 <td><b>${overallTotals[0]}</b></td>
                                 <td><b>${overallTotals[1]}</b></td>
                                 <td><b>${overallTotals[2]}</b></td>
                                 </tr>`;
        content += `<tr></tr><tr style="color: #03DC03"><td><b>Enlightened</b></td>
        <td><b>${totals['Enlightened'][0]}</b></td>
        <td><b>${totals['Enlightened'][1]}</b></td>
        <td><b>${totals['Enlightened'][2]}</b></td>
        </tr>`;
        content += `<tr></tr><tr style="color: #00C5FF"><td><b>Resistance</b></td>
        <td><b>${totals['Resistance'][0]}</b></td>
        <td><b>${totals['Resistance'][1]}</b></td>
        <td><b>${totals['Resistance'][2]}</b></td>
        </tr>`;
        if (totals['Unknown']) content += `<tr></tr><tr style="color: #ffFFFF"><td><b>Unknown</b></td>
        <td><b>${totals['Unknown'][0]}</b></td>
        <td><b>${totals['Unknown'][1]}</b></td>
        <td><b>${totals['Unknown'][2]}</b></td>
        </tr>`;
        if (totals['Machina']) content += `<tr></tr><tr style="color: #ff3300"><td><b>Machina</b></td>
        <td><b>${totals['Machina'][0]}</b></td>
        <td><b>${totals['Machina'][1]}</b></td>
        <td><b>${totals['Machina'][2]}</b></td>
        </tr>`;
        content += '</table>';
        $('#agent-link-counter-content').html(content);
    };

    self.resetCounter = function() {
        self.linkCounts = {};
        self.seenLinks.clear();
        self.lastResetTime = Date.now();
        self.saveLinkCounts();
        self.updateCounter();
        self.updateCountingUI();
    };

    self.addLink = function(agent, faction, timestamp) {
        if (timestamp < self.lastResetTime) {
            return; // Ignore links created before the last reset
        }
        if (!self.linkCounts[agent]) {
            self.linkCounts[agent] = {count: 0, faction: faction, fields: 0, mus: 0}
        }
        self.linkCounts[agent].count++;
        self.linkCounts[agent].faction = faction;
        self.saveLinkCounts();
        self.updateCounter();
    };

    self.addField = function(agent, faction, mu, timestamp) {
        if (timestamp < self.lastResetTime) {
            return; // Ignore links created before the last reset
        }
        if (!self.linkCounts[agent]) {
            self.linkCounts[agent] = {count: 0, faction: faction, fields: 0, mus: 0};
        }
        self.linkCounts[agent].fields++;
        self.linkCounts[agent].mus+=mu;
        self.linkCounts[agent].faction = faction;
        self.saveLinkCounts();
        self.updateCounter();
    };

    self.formatDate = function(timestamp) {
        var date = new Date(timestamp);
        return date.toLocaleString(); // This will use the user's locale settings
    };

    self.setupUI = function() {
        var container = $('<div id="agent-link-counter-dialog">')
            .append('<div id="agent-link-counter-content"></div>')
            .appendTo('body');


        container.dialog({
            autoOpen: false,
            title: 'Link and Field Counter',
            width: 300,
            position: { my: "left top", at: "left+20 top+20", of: "#map" }
        });

        var infoLabel = $('<div>')
            .attr('id', 'link-counter-info')
            .appendTo(container);

        var link = $('<a>')
            .html('Link And Field Counter')
            .click(function() {
                container.dialog('open');
            });

        var resetButton = $('<button>')
            .text('Reset Counters')
            .click(self.resetCounter);

        container.append(resetButton);

        var toggleButton = $('<button>')
            .attr('id', 'link-counter-toggle')
            .text(self.isCountingEnabled ? 'Disable Counting' : 'Enable Counting')
            .click(self.toggleCounting);

        container.append(toggleButton);

        if (window.useAppPanes()) {
            link.appendTo($('#sidebartoggle'));
        } else {
            link.appendTo($('#toolbox'));
        }

        self.updateCounter();
        self.updateCountingUI();
    };

    self.handleNewChatMessage = function(data) {
        if (!self.isCountingEnabled) return;
        if (data.result && data.result.length > 0) {
            data.result.forEach(function(msg) {
                if (msg[2].plext && msg[2].plext.plextType === 'SYSTEM_BROADCAST') {
                    var text = msg[2].plext.text;
                    var parts = text.split(' ');
                    var agent = parts[2];
                    var faction = parts[0];
                    if (faction != 'Enlightened' && faction != 'Resistance') {
                        agent = 'Machina'
                        faction = 'Machina';
                    }
                    var objectId = msg[0];
                    var timestamp = msg[1];
                    if (text.indexOf(' linked ') !== -1) {
                        if (!self.seenLinks.has(objectId)) {
                            self.seenLinks.add(objectId);
                            self.addLink(agent, faction, timestamp);
                        }
                    }
                    if (text.indexOf('created a Control') !== -1) {
                        var mu = 1 * msg[2].plext.markup[6][1].plain;
                        if (!self.seenLinks.has(objectId)) {
                            self.seenLinks.add(objectId);
                            self.addField(agent, faction, mu, timestamp);
                        }
                    }

                }
            });
        }
    };

    self.updateInfoLabel = function() {
        var infoText = 'Since: ' + self.formatDate(self.lastResetTime) + '<br>';
        infoText += 'Recording: ' + (self.isCountingEnabled ? '<span style="color: #ff00ff">Yes</span>' : '<span style="color: #ffff00">No</span>');
        $('#link-counter-info').html(infoText);
    };

    var setup = function() {
        self.loadLinkCounts();
        self.setupUI();
        window.addHook('publicChatDataAvailable', self.handleNewChatMessage);
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

