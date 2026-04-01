// ==UserScript==
// @id             iitc-plugin-drone-planner@57Cell
// @name           IITC Plugin: 57Cell's Drone Flight Planner
// @version        1.1.0.20260331
// @description    Plugin for planning drone flights in IITC
// @author         57Cell (Michael Hartley) and ChatGPT 4.0, collaborations by kyke31 (Enrique H.) using Gemini 2.0
// @category       Layer
// @namespace      https://github.com/jonatkins/ingress-intel-total-conversion
// @updateURL      https://github.com/mike40033/iitc-57Cell/raw/master/plugins/drone-flight-planner/drone-flight-planner.meta.js
// @downloadURL    https://github.com/mike40033/iitc-57Cell/raw/master/plugins/drone-flight-planner/drone-flight-planner.user.js
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
// @grant          none
// ==/UserScript==

function wrapper(plugin_info) {
    if (typeof window.plugin !== 'function') window.plugin = function() {};
    plugin_info.buildName = '';
    plugin_info.dateTimeVersion = '20260331';
    plugin_info.pluginId = '57CellsDronePlanner';

    const pluginName = "57Cell's Drone Planner";
    const version = "1.1.0";
    const changeLog = [
        {
            version: '1.1.0.20260331',
            changes: [
                'OVERHAUL: Split UI into "Portals Data" (Acquisition) and "Flight Planning" (Tactical)',
                'NEW: Manual Origin selection mode via "Set Origin Portal" button',
                'NEW: Operational modes: "Current View Only" (Auto-calc) and "Extended Cache" (Manual trigger)',
                'NEW: Coverage Map (Breadcrumbs) to visualize scanned areas on map',
                'FIX: High-performance scanning using spatial hashing (bucketing)',
                'FIX: Robust storage optimization - graph is rebuilt in-memory to prevent localStorage quota errors',
                'FIX: Absolute furthest portal targeting with most-efficient path generation',
                'FIX: UI highlighting on hover for plan table rows',
                'FIX: Use Yellow (#FFFF00) for neutral highlights to avoid faction color conflicts',
            ],
        },
        {
            version: '1.0.5.20251208',
            changes: [
                'NEW: Major UI overhaul and advanced routing strategies (Max Unique, Farming)',
            ],
        },
        {
            version: '1.0.1.20250909',
            changes: [
                'NEW: Allow users to disallow the key trick',
            ],
        },
        {
            version: '1.0.0.20250816',
            changes: [
                'NEW: Initial Public Release',
            ],
        },
    ];

    // PLUGIN START
    console.log('DronePlanner: Loading plugin...');
    let self = window.plugin.dronePlanner = function() {};

    // --- Config & State ---
    self.PLUGIN_VERSION = "1.1.0";
    
    self.linksLayerGroup = null;
    self.fieldsLayerGroup = null;
    self.highlightLayergroup = null;

    self.allPortals = {};
    self.graph = {};
    self.userBlockedNodes = new Set();
    self.scannedAreas = []; // Track map bounds of each scan
    self.coverageLayerGroup = null;
    self.isSettingOrigin = false; // Flag for manual origin selection

    self.loadData = function() {
        try {
            var data = JSON.parse(localStorage['plugins-drone-planner-data'] || '{}');
            if (data.allPortals) self.allPortals = data.allPortals;
            if (data.userBlockedNodes) self.userBlockedNodes = new Set(data.userBlockedNodes);
            if (data.scannedAreas) self.scannedAreas = data.scannedAreas;
            
            // Rebuild graph from cached portals
            self.graph = {};
            let keys = Object.keys(self.allPortals);
            if (keys.length > 0) {
                console.log(`Drone Planner: Rebuilding graph for ${keys.length} cached portals...`);
                self.rebuildGraphFromCache();
            }
            
            // Restore UI settings if they exist
            if (data.settings) {
                if (data.settings.shortHopColor) $("#dp-color-short").val(data.settings.shortHopColor);
                if (data.settings.longHopColor) $("#dp-color-long").val(data.settings.longHopColor);
                if (data.settings.fullTreeColor) $("#dp-color-tree").val(data.settings.fullTreeColor);
                if (data.settings.hopLength) $("#dp-hop-length").val(data.settings.hopLength);
                if (data.settings.strategy) $(`input[name="dp-strategy"][value="${data.settings.strategy}"]`).prop('checked', true);
                if (data.settings.pathType) $("#dp-path-type").val(data.settings.pathType);
                if (data.settings.allowLongHops) $(`input[name="dp-allow-long"][value="${data.settings.allowLongHops}"]`).prop('checked', true);
                
                // We keep the last mode selection during the session
                if (data.settings.scanMode) $("#dp-scan-mode").val(data.settings.scanMode);
            }

            console.log('Drone Planner: Data loaded successfully.');
            self.updateUIHUD(); // Sync the HUD immediately after data is ready
        } catch (e) {
            console.warn('Drone Planner: Failed to load cached data', e);
            self.allPortals = {};
            self.graph = {};
        }
    }

    self.saveData = function() {
        try {
            // Pruning: Keep cache under 2500 portals to avoid QuotaExceededError
            let keys = Object.keys(self.allPortals);
            if (keys.length > 2500) {
                console.log("DronePlanner: Pruning cache...");
                let toRemove = keys.length - 2500;
                // Keep portals in current plan, remove oldest others
                let protected = new Set(self.plan ? self.plan.furthestPath : []);
                let removed = 0;
                for (let i = 0; i < keys.length && removed < toRemove; i++) {
                    if (!protected.has(keys[i])) {
                        delete self.allPortals[keys[i]];
                        delete self.graph[keys[i]];
                        removed++;
                    }
                }
            }

            var data = {
                allPortals: self.allPortals,
                userBlockedNodes: Array.from(self.userBlockedNodes),
                scannedAreas: self.scannedAreas,
                settings: {
                    shortHopColor: $("#dp-color-short").val(),
                    longHopColor: $("#dp-color-long").val(),
                    fullTreeColor: $("#dp-color-tree").val(),
                    hopLength: $("#dp-hop-length").val(),
                    strategy: $('input[name="dp-strategy"]:checked').val(),
                    pathType: $('#dp-path-type').val(),
                    allowLongHops: $('input[name="dp-allow-long"]:checked').val(),
                    scanMode: $('#dp-scan-mode').val()
                }
            };
            localStorage['plugins-drone-planner-data'] = JSON.stringify(data);
        } catch (e) {
            console.warn('Drone Planner: Failed to save data to localStorage', e);
        }
    }

    self.rebuildGraphFromCache = function() {
        console.time("DronePlanner: RebuildGraph");
        try {
            const BUCKET_SIZE = 0.02;
            let buckets = {};
            function getBucketId(latE6, lngE6) {
                return Math.floor((latE6 / 1e6) / BUCKET_SIZE) + "_" + Math.floor((lngE6 / 1e6) / BUCKET_SIZE);
            }

            // Reset graph
            self.graph = {};
            for (let key in self.allPortals) self.graph[key] = [];

            // Bucket all portals
            for (let key in self.allPortals) {
                let p = self.allPortals[key];
                let bid = getBucketId(p.latE6, p.lngE6);
                if (!buckets[bid]) buckets[bid] = [];
                buckets[bid].push(key);
            }

            // Link portals
            let maxDist = self.getHardMaxDistance();
            for (let key in self.allPortals) {
                let p = self.allPortals[key];
                let lat = p.latE6 / 1e6;
                let lng = p.lngE6 / 1e6;
                let bx = Math.floor(lat / BUCKET_SIZE);
                let by = Math.floor(lng / BUCKET_SIZE);

                for (let x = bx - 1; x <= bx + 1; x++) {
                    for (let y = by - 1; y <= by + 1; y++) {
                        let neighborBid = `${x}_${y}`;
                        if (buckets[neighborBid]) {
                            buckets[neighborBid].forEach(otherKey => {
                                if (key < otherKey) {
                                    let distance = self.getDistance(key, otherKey);
                                    if (distance <= maxDist) {
                                        self.graph[key].push(otherKey);
                                        self.graph[otherKey].push(key);
                                    }
                                }
                            });
                        }
                    }
                }
            }
            console.timeEnd("DronePlanner: RebuildGraph");
        } catch (e) {
            console.error("DronePlanner: Rebuild failed", e);
        }
    }

    self.addPortalToGraph = function(key, data) {
        if (!self.allPortals.hasOwnProperty(key)) {
            self.allPortals[key] = data;
            self.graph[key] = [];

            let maxDist = self.getHardMaxDistance();
            for (let otherKey in self.allPortals) {
                if (key !== otherKey) {
                    let distance = self.getDistance(key, otherKey);
                    if (distance <= maxDist) {
                        self.graph[key].push(otherKey);
                        if (!self.graph[otherKey].includes(key)) {
                            self.graph[otherKey].push(key);
                        }
                    }
                }
            }
            self.saveData();
        }
    }
    
    // --- CSS ---
    self.setupCSS = function() {
        $("<style>").prop("type", "text/css").html(`
            #dp-dialog { display: flex; height: 100%; width: 100%; font-family: sans-serif; font-size: 12px; color: #ccc; background-color: #202020; overflow: hidden; }
            
            /* Main Layout */
            .dp-list-container { flex: 1; overflow: auto; border-right: 1px solid #444; background-color: #202020; position: relative; }
            .dp-controls { width: 240px; display: flex; flex-direction: column; gap: 8px; padding: 8px; background: #1b1b1b; overflow-y: auto; flex-shrink: 0; box-sizing: border-box; }

            /* Control Groups */
            .dp-group { margin-bottom: 5px; border: 1px solid #444; padding: 6px; border-radius: 4px; background: #222; }
            .dp-group-title { font-weight: bold; color: #4da; margin-bottom: 6px; display: block; font-size: 11px; text-transform: uppercase; border-bottom: 1px solid #444; padding-bottom: 2px; }
            
            /* Player Controls */
            .dp-player { display: flex; gap: 4px; margin-bottom: 6px; }
            .dp-player-btn { flex: 1; background: #333; border: 1px solid #555; color: #fff; padding: 4px; cursor: pointer; font-size: 14px; border-radius: 3px; }
            .dp-player-btn:hover:not(:disabled) { background: #444; border-color: #777; }
            .dp-player-btn:disabled { opacity: 0.3; cursor: not-allowed; }
            .dp-btn-rec { color: #f55 !important; }
            .dp-btn-reset { color: #aaa !important; }
            .dp-btn-origin { background: #442 !important; border-color: #ff0 !important; color: #ff0 !important; }
            .dp-btn-origin.active { background: #ff0 !important; color: #000 !important; }

            /* HUD */
            .dp-hud { font-family: monospace; background: #000; padding: 4px; border-radius: 2px; border: 1px solid #333; font-size: 10px; color: #0f0; margin-bottom: 4px; }
            .dp-hud-label { color: #888; }

            /* Buttons */
            .dp-btn-main { width: 100%; background: #1b3a4b; border: 1px solid #4da; color: #fff; padding: 8px; cursor: pointer; font-weight: bold; border-radius: 3px; }
            .dp-btn-main:hover:not(:disabled) { background: #2b4a5b; }
            .dp-btn-main:disabled { opacity: 0.3; cursor: not-allowed; }

            /* Table Styles */
            .dp-table { width: 100%; border-collapse: collapse; min-width: 300px; }
            .dp-table th, .dp-table td { border: 1px solid #444; padding: 4px; white-space: nowrap; }
            .dp-table th { background-color: #1b3a4b; position: sticky; top: 0; z-index: 10; color: #fff; text-align: left; padding: 6px; }
            .dp-table tr:nth-child(even) { background-color: #262626; }
            .dp-table tr:hover { background-color: #333; }
            .dp-col-center { text-align: center !important; }
            .dp-col-right { text-align: right !important; }

            /* Button Styles */
            .dp-btn { background-color: #204020; border: 1px solid #3c6; color: #fff; padding: 6px; cursor: pointer; text-align: center; border-radius: 2px; user-select: none; font-weight: bold; }
            .dp-btn:hover { background-color: #306030; }
            .dp-btn.active { background-color: #3c6; color: #000; }
            .dp-btn-action { background-color: #1b3a4b; border: 1px solid #4da; color: #fff; }
            .dp-btn-action:hover { background-color: #2b4a5b; }
            .dp-btn-danger { background-color: #402020; border: 1px solid #f55; color: #fff; }
            .dp-btn-danger:hover { background-color: #603030; }
            .dp-btn-sm { padding: 2px 5px; font-size: 10px; }

            .dp-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
            .dp-row label { cursor: pointer; }
            .dp-input-sm { width: 50px; background: #333; border: 1px solid #555; color: #fff; padding: 2px; text-align: right; }
            .dp-color-input { height: 20px; width: 30px; border: none; padding: 0; background: none; cursor: pointer; }

            /* Text & Badges */
            .dp-fact { font-weight: bold; font-size: 10px; padding: 1px 3px; border-radius: 2px; }
            .fact-enl { color: #0f0; }
            .fact-res { color: #00f; }
            .fact-mac { color: #f00; }
            .fact-neu { color: #aaa; }
            
            .dp-step-dir { color: #4da; font-weight: bold; }
            .dp-step-name { font-weight: bold; color: #ddd; cursor: pointer; }
            .dp-step-name:hover { text-decoration: underline; color: #fff; }
            
            .dp-btn-alt { cursor: pointer; background: #333; border: 1px solid #666; color: #f55; border-radius: 3px; padding: 0 4px; font-size: 10px; }
            .dp-btn-alt:hover { background: #f55; color: #fff; border-color: #f00; }

            .dp-long-hop { border-left: 3px solid #f00; }
            .dp-short-hop { border-left: 3px solid #cc44ff; }

            /* Loading Overlay */
            .dp-loading { position: absolute; top:0; left:0; right:0; padding: 10px; background: rgba(255, 255, 170, 0.9); color: #000; text-align: center; font-weight: bold; z-index: 20; display: none;}
            
            /* Footer/Stats Area */
            .dp-stats-row { display: flex; justify-content: space-between; font-size: 11px; color: #aaa; margin-top: 4px; padding-top: 4px; border-top: 1px solid #333;}
            .dp-stat-val { color: #fff; font-weight: bold; }
        `).appendTo("head");
    };

    // --- GRAPH BUILDING ---
    self.scanPortalsAndUpdateGraph = function() {
        // Zoom Sentry: Warn if zoom is too low (< 15)
        if (window.map.getZoom() < 15) {
            if (!confirm("Your zoom level is low. IITC may hide smaller portals, which will result in an incomplete flight graph. Continue anyway?")) {
                return;
            }
        }
        $(".dp-loading").text("Scanning...").show();
        setTimeout(() => { self.performScan(); }, 50);
    }

    self.performScan = function() {
        console.time("DronePlanner: GraphBuild");
        try {
            let bounds = map.getBounds();
            
            // Coverage Map: Record the scan area
            self.scannedAreas.push(bounds);
            self.drawCoverage();

            let newPortalsCount = 0;
            // 1. Identify portals in view
            let portalsInView = {};
            for (let key in window.portals) {
                let portal = window.portals[key];
                if (bounds.contains(portal.getLatLng())) {
                    portalsInView[key] = portal.options.data;
                }
            }

            // 2. Spatial Hashing (Bucketing) for all known portals
            const BUCKET_SIZE = 0.02; // Roughly 2km grid
            let buckets = {};
            function getBucketId(latE6, lngE6) {
                return Math.floor((latE6 / 1e6) / BUCKET_SIZE) + "_" + Math.floor((lngE6 / 1e6) / BUCKET_SIZE);
            }

            // Bucket existing portals
            for (let key in self.allPortals) {
                let p = self.allPortals[key];
                let bid = getBucketId(p.latE6, p.lngE6);
                if (!buckets[bid]) buckets[bid] = [];
                buckets[bid].push(key);
            }

            // 3. Process new portals using buckets
            let maxDist = self.getHardMaxDistance();
            for (let key in portalsInView) {
                if (!self.allPortals.hasOwnProperty(key)) {
                    let p = portalsInView[key];
                    self.allPortals[key] = p;
                    self.graph[key] = [];
                    newPortalsCount++;

                    let lat = p.latE6 / 1e6;
                    let lng = p.lngE6 / 1e6;
                    let bx = Math.floor(lat / BUCKET_SIZE);
                    let by = Math.floor(lng / BUCKET_SIZE);

                    // Check 3x3 grid of buckets
                    for (let x = bx - 1; x <= bx + 1; x++) {
                        for (let y = by - 1; y <= by + 1; y++) {
                            let neighborBid = `${x}_${y}`;
                            if (buckets[neighborBid]) {
                                buckets[neighborBid].forEach(otherKey => {
                                    let distance = self.getDistance(key, otherKey);
                                    if (distance <= maxDist) {
                                        self.graph[key].push(otherKey);
                                        if (!self.graph[otherKey].includes(key)) {
                                            self.graph[otherKey].push(key);
                                        }
                                    }
                                });
                            }
                        }
                    }

                    // Add new portal to its bucket
                    let bid = getBucketId(p.latE6, p.lngE6);
                    if (!buckets[bid]) buckets[bid] = [];
                    buckets[bid].push(key);
                }
            }

            console.log(`DronePlanner: Scan complete. Added ${newPortalsCount} new portals.`);
            console.timeEnd("DronePlanner: GraphBuild");
            self.updatePlan();
        } catch (e) {
            console.error("DronePlanner: Scan failed", e);
        } finally {
            $(".dp-loading").hide();
            self.saveData();
        }
    }

    self.drawCoverage = function() {
        if (!self.coverageLayerGroup) return;
        self.coverageLayerGroup.clearLayers();
        
        if (!$("#dp-show-coverage").is(":checked")) return;

        self.scannedAreas.forEach(bounds => {
            L.rectangle(bounds, {
                color: "#4da",
                weight: 1,
                fillColor: "#4da",
                fillOpacity: 0.05,
                interactive: false
            }).addTo(self.coverageLayerGroup);
        });
    }

    // --- PATHFINDING ---
    self.delayedUpdatePlan = function() {
        $(".dp-loading").text("Calculating Path...").show();
        setTimeout(() => { self.updatePlan(); }, 50);
    }

    self.updateUIHUD = function() {
        if (!self.dialogIsOpen()) return;
        $("#dp-hud-portals").text(Object.keys(self.allPortals).length);
        $("#dp-hud-scans").text(self.scannedAreas.length);
        $("#dp-hud-origin").text(self.startPortal ? self.getPortalNameFromGUID(self.startPortal.guid) : "None");
        
        let mode = $("#dp-scan-mode").val();
        
        // Mode-specific UI adjustments
        if (mode === "single") {
            $("#dp-calc-container").hide();
            $("#dp-btn-record").attr("title", "Resets cache and scans current view. PLEASE WAIT for the map to finish loading.");
        } else {
            $("#dp-calc-container").show();
            $("#dp-btn-record").attr("title", "Appends current view to existing cache. PLEASE WAIT for the map to finish loading.");
        }

        // Enable/Disable Calculate button
        let canPlan = self.startPortal && Object.keys(self.allPortals).length > 0;
        $("#dp-btn-calculate").prop("disabled", !canPlan);
        $("#dp-btn-set-origin").prop("disabled", Object.keys(self.allPortals).length === 0);
    }

    self.updatePlan = function(manualTrigger) {
        if (!self.startPortal) {
            self.renderPlanTable(null);
            $(".dp-loading").hide();
            self.updateUIHUD();
            return;
        }

        // Logic: If in "extended" mode, only calculate if manually triggered or rerouting
        let mode = $("#dp-scan-mode").val();
        if (mode === "extended" && !manualTrigger) {
            console.log("DronePlanner: Skipping auto-calc in Extended mode.");
            self.updateUIHUD();
            return;
        }

        let graph = self.graph;
        console.log("DronePlanner: Starting plan update for", self.startPortal.guid);

        try {
            // Routing Logic Switcher
            if (document.getElementById('opt-max-unique').checked) {
                 console.time("DronePlanner: UniquePathCalc");
                 let uniquePath = self.findMaxUniquePath(graph, self.startPortal.guid);
                 self.plan = { furthestPath: uniquePath, tree: {} };
                 console.timeEnd("DronePlanner: UniquePathCalc");
            } else if (document.getElementById('opt-farming').checked) {
                 console.time("DronePlanner: FarmingCalc");
                 let farmingPath = self.findFarmingPath(graph, self.startPortal.guid);
                 self.plan = { furthestPath: farmingPath, tree: {} };
                 console.timeEnd("DronePlanner: FarmingCalc");
            } else {
                console.time("DronePlanner: TargetFurthestCalc");
                self.plan = self.findMinimumCostPath(graph);
                console.timeEnd("DronePlanner: TargetFurthestCalc");
            }

            if (self.plan && self.plan.furthestPath && self.plan.furthestPath.length > 0) {
                let totalDist = self.getDistance(self.plan.furthestPath[0], self.plan.furthestPath[self.plan.furthestPath.length - 1]) / 1000;
                console.log(`DronePlanner: Plan calculated. Path length: ${self.plan.furthestPath.length} | Total Distance: ${totalDist.toFixed(2)} km`);
                self.updateLayer();
            } else {
                console.log("DronePlanner: No valid path found.");
                self.renderPlanTable(null);
                self.clearLayers();
            }
        } catch (e) {
            console.error("DronePlanner: Calculation failed", e);
            alert("Path calculation failed. Check browser console for details.");
        } finally {
            $(".dp-loading").hide();
            self.updateUIHUD();
        }
    }

    // "Max Unique" Logic
    self.findMaxUniquePath = function(graph, startNode) {
        let path = [startNode];
        let visited = new Set([startNode]);
        let current = startNode;
        let longHopThreshold = self.getLongHopThreshold();
        let maxSteps = 500; // Safety limit

        for (let i = 0; i < maxSteps; i++) {
            if (!graph[current]) break;
            let neighbors = graph[current].filter(n => !visited.has(n) && !self.userBlockedNodes.has(n));
            if (neighbors.length === 0) break;

            neighbors.sort((a, b) => {
                let distA = self.getDistance(current, a);
                let distB = self.getDistance(current, b);
                let isShortA = distA <= longHopThreshold;
                let isShortB = distB <= longHopThreshold;
                if (isShortA && !isShortB) return -1;
                if (!isShortA && isShortB) return 1;
                
                let countA = (graph[a] || []).filter(n => !visited.has(n) && !self.userBlockedNodes.has(n)).length;
                let countB = (graph[b] || []).filter(n => !visited.has(n) && !self.userBlockedNodes.has(n)).length;
                return countB - countA;
            });

            let nextNode = neighbors[0];
            let dist = self.getDistance(current, nextNode);
            if (dist > longHopThreshold && !self.areLongHopsAllowed()) {
                 let validNode = neighbors.find(n => self.getDistance(current, n) <= longHopThreshold);
                 if (validNode) nextNode = validNode;
                 else break;
            }
            visited.add(nextNode);
            path.push(nextNode);
            current = nextNode;
        }
        return path;
    }

    // "Max Portal Visits" (Farming) Logic
    self.findFarmingPath = function(graph, startNode) {
        let path = [startNode];
        let visited = new Set([startNode]);
        let current = startNode;
        let longHopThreshold = self.getLongHopThreshold();
        let maxSteps = 1000; // Safety limit

        for (let i = 0; i < maxSteps; i++) {
            if (!graph[current]) break;
            let neighbors = graph[current].filter(n => !visited.has(n) && !self.userBlockedNodes.has(n));
            if (neighbors.length === 0) break;

            // Nearest Neighbor Greedy
            neighbors.sort((a, b) => {
                let distA = self.getDistance(current, a);
                let distB = self.getDistance(current, b);
                return distA - distB;
            });

            let nextNode = null;
            for (let candidate of neighbors) {
                let dist = self.getDistance(current, candidate);
                if (dist > longHopThreshold && !self.areLongHopsAllowed()) continue;
                nextNode = candidate;
                break;
            }

            if (!nextNode) break;
            visited.add(nextNode);
            path.push(nextNode);
            current = nextNode;
        }
        return path;
    }

    self.findMinimumCostPath = function(graph) {
        let pnfp = self.createSpanningTreeAndFindFurthestPortal(graph);
        let candidates = pnfp.candidates.slice(0, 20); 
        
        if (candidates.length === 0) return { furthestPath: [], tree: {} };

        let bestPath = [];
        
        // Try top candidates in order of straight-line distance
        for (let i = 0; i < candidates.length; i++) {
            let target = candidates[i];
            let path = self.applyAStar(graph, self.startPortal.guid, target.guid, self.heuristic);
            
            if (path.length > 0) {
                bestPath = path;
                break; // Found the furthest reachable one
            }
        }

        return { furthestPath: bestPath, tree: self.constructTree(pnfp.pn) };
    };

    self.createSpanningTreeAndFindFurthestPortal = function(graph) {
        let previousNodes = {};
        let visited = new Set();
        visited.add(self.startPortal.guid);
        let queue = [self.startPortal.guid];
        let longHopThreshold = self.getLongHopThreshold();
        let allReachable = [];

        while (queue.length > 0) {
            let current = queue.shift();
            
            if (graph[current]) {
                graph[current].forEach(neighbor => {
                    if (!visited.has(neighbor) && !self.userBlockedNodes.has(neighbor)) {
                        let distance = self.getDistance(current, neighbor);
                        let isShortHop = distance <= longHopThreshold;
                        if (!isShortHop && !self.areLongHopsAllowed()) return;
                        
                        visited.add(neighbor);
                        previousNodes[neighbor] = current;
                        
                        let distFromStart = self.getDistance(self.startPortal.guid, neighbor);
                        allReachable.push({ guid: neighbor, dist: distFromStart });

                        if (isShortHop) queue.unshift(neighbor);
                        else queue.push(neighbor);
                    }
                });
            }
        }

        // Sort by straight-line distance and take top 50
        allReachable.sort((a, b) => b.dist - a.dist);
        let candidates = allReachable.slice(0, 50);
        
        return {pn: previousNodes, candidates: candidates};
    };

    self.heuristic = function (node, goal) {
        let distMetres = self.getDistance(node, goal);
        let longHopThreshold = self.getLongHopThreshold();
        let shortHopCost = Math.ceil(distMetres / longHopThreshold);
        let numLongHops = Math.floor(distMetres / self.getHardMaxDistance());
        let numShortHops = 0;
        if (distMetres - self.getHardMaxDistance()*numLongHops > longHopThreshold) numLongHops++;
        else numShortHops++;
        
        let longHopCost = Infinity;
        if (self.areLongHopsAllowed()) longHopCost = self.getCostFromHops(numLongHops,numShortHops);
        return Math.min(longHopCost, shortHopCost);
    }

    self.applyAStar = function(graph, start, end, heuristic) {
        let openSet = [start];
        let cameFrom = {};
        let gScore = { [start]: 0 };
        let fScore = { [start]: heuristic(start, end) };
        let longHopThreshold = self.getLongHopThreshold();

        while (openSet.length > 0) {
            // Faster than full sort: find min index
            let minIdx = 0;
            for (let i = 1; i < openSet.length; i++) {
                if (fScore[openSet[i]] < fScore[openSet[minIdx]]) minIdx = i;
            }
            let current = openSet.splice(minIdx, 1)[0];

            if (current === end) return self.reconstructPath(cameFrom, current);

            if (graph[current]) {
                graph[current].forEach(neighbor => {
                    if (self.userBlockedNodes.has(neighbor)) return;
                    let distance = self.getDistance(current, neighbor);
                    let isLongHop = distance > longHopThreshold;
                    if (isLongHop && !self.areLongHopsAllowed()) return;
                    let cost = isLongHop ? self.getCostFromHops(1, 0) : self.getCostFromHops(0, 1);
                    let tentative_gScore = gScore[current] + cost;
                    if (!gScore.hasOwnProperty(neighbor) || tentative_gScore < gScore[neighbor]) {
                        cameFrom[neighbor] = current;
                        gScore[neighbor] = tentative_gScore;
                        let tentative_fScore = gScore[neighbor] + heuristic(neighbor, end);
                        if (!fScore.hasOwnProperty(neighbor)) {
                            fScore[neighbor] = tentative_fScore;
                            openSet.push(neighbor);
                        } else if (tentative_fScore < fScore[neighbor]) fScore[neighbor] = tentative_fScore;
                    }
                });
            }
        }
        return [];
    };

    self.reconstructPath = function(cameFrom, current) {
        let totalPath = [current];
        while (Object.keys(cameFrom).includes(current)) {
            current = cameFrom[current];
            totalPath.unshift(current);
            if (totalPath.length > 1000) return [current];
        }
        return totalPath;
    };

    // --- UTILITIES ---
    self.getLongHopThreshold = function() {
        let val = parseInt($('#dp-hop-length').val());
        if (isNaN(val) || val < 0) return 500;
        return val;
    }

    self.getCostFromHops = function(longHops, shortHops) {
        let pathType = $('input[name="dp-path-type"]:checked').val();
        let penalty = 3;
        if (pathType === 'min-long-hops') penalty = 100;
        if (pathType === 'min-hops') penalty = 1.01;
        return shortHops + (longHops * penalty);
    };

    self.areLongHopsAllowed = function() {
        return $('input[name="dp-allow-long"]:checked').val() == "yes";
    }

    self.getHardMaxDistance = function() { return 1250; }

    self.constructTree = function(previousNodes) {
        let tree = {};
        for (let key in previousNodes) {
            tree[key] = { parent: previousNodes[key] };
        }
        return tree;
    };

    self.getCardinalDirection = function(guidFrom, guidTo) {
        if (!guidFrom || !guidTo) return "";
        let ll1 = self.getLatLng(guidFrom);
        let ll2 = self.getLatLng(guidTo);
        if (!ll1 || !ll2) return "";
        
        let y = Math.sin(ll2.lng * Math.PI / 180 - ll1.lng * Math.PI / 180) * Math.cos(ll2.lat * Math.PI / 180);
        let x = Math.cos(ll1.lat * Math.PI / 180) * Math.sin(ll2.lat * Math.PI / 180) -
                Math.sin(ll1.lat * Math.PI / 180) * Math.cos(ll2.lat * Math.PI / 180) * Math.cos(ll2.lng * Math.PI / 180 - ll1.lng * Math.PI / 180);
        let bearing = Math.atan2(y, x) * 180 / Math.PI;
        bearing = (bearing + 360) % 360;

        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'];
        return directions[Math.round(bearing / 45)];
    }

    self.getFactionCode = function(guid) {
        let p = self.allPortals[guid];
        if (!p) return { code: "---", class: "fact-neu" };
        let t = p.team; 
        if (t === 'R' || t === 1) return { code: "RES", class: "fact-res" };
        if (t === 'E' || t === 2) return { code: "ENL", class: "fact-enl" };
        if (t === 'M' || t === 3) return { code: "MAC", class: "fact-mac" };
        return { code: "---", class: "fact-neu" };
    }
    
    self.blockAndReroute = function(guid) {
        self.userBlockedNodes.add(guid);
        self.updatePlan(true); // Always recalculate when node blocked
    }

    self.copyPlanToClipboard = function() {
        if (!self.plan || !self.plan.furthestPath) {
            alert("No flight plan to copy.");
            return;
        }
        let text = "";
        
        for (let i = 0; i < self.plan.furthestPath.length; i++) {
            let guid = self.plan.furthestPath[i];
            let name = self.getPortalNameFromGUID(guid);
            let faction = self.getFactionCode(guid).code;
            let dir = "";
            let distance = 0;
            
            if (i > 0) {
                let prevGuid = self.plan.furthestPath[i-1];
                dir = self.getCardinalDirection(prevGuid, guid);
                distance = self.getDistance(prevGuid, guid);
            }
            
            text += `${i}. [${dir}] [${faction}] ${name} (${Math.round(distance)}m)\n`;
        }

        navigator.clipboard.writeText(text).then(function() {
            alert("Flight plan copied to clipboard!");
        }, function(err) {
            alert("Failed to copy to clipboard.");
        });
    }

    // --- UI RENDERING ---
    self.renderPlanTable = function(path) {
        let container = $("#dp-plan-body");
        if (!path || path.length === 0) {
            let message = "Scan area and set Start to begin.";
            if (self.startPortal) {
                if (Object.keys(self.allPortals).length <= 1) {
                    message = "No other portals in cache. Click 'Scan Area Portals' to find neighbors.";
                } else {
                    message = "No reachable portals found from this start point. Try increasing the Hop Limit or scanning a denser area.";
                }
            }
            container.html(`<tr><td colspan="6" style="text-align:center; padding:20px; color:#888;">${message}</td></tr>`);
            $("#dp-stats").html("");
            return;
        }

        let longHopThreshold = self.getLongHopThreshold();
        let html = "";
        
        let totalDistance = self.getDistance(path[0], path[path.length-1]) / 1000;
        let hopCount = path.length - 1;
        
        $("#dp-stats").html(`<div class="dp-stats-row"><span class="dp-stat-val">${totalDistance.toFixed(2)} km</span> total distance &nbsp;|&nbsp; <span class="dp-stat-val">${hopCount}</span> hops</div>`);

        for (let i = 0; i < path.length; i++) {
            let guid = path[i];
            let name = self.getPortalNameFromGUID(guid);
            let factInfo = self.getFactionCode(guid);
            let p = self.allPortals[guid];
            let intelLink = p ? `https://intel.ingress.com/?pll=${p.latE6/1e6},${p.lngE6/1e6}` : '#';
            
            let distance = i == 0 ? 0 : self.getDistance(path[i], path[i-1]);
            let isLong = distance > longHopThreshold;
            let rowClass = isLong ? "dp-long-hop" : "dp-short-hop";
            
            let dir = i > 0 ? self.getCardinalDirection(path[i-1], guid) : "-";
            let altBtn = i > 0 ? `<div class="dp-btn-alt" title="Block & Reroute" data-guid="${guid}">Avoid This</div>` : '';
            
            html += `<tr class="${rowClass}">
                        <td class="dp-col-center">${i}</td>
                        <td class="dp-col-center dp-step-dir">${dir}</td>
                        <td class="dp-col-center"><span class="dp-fact ${factInfo.class}">${factInfo.code}</span></td>
                        <td><a href="${intelLink}" target="_blank" style="text-decoration:none; color:inherit"><span class="dp-step-name" data-guid="${guid}" title="${name}">${name}</span></a></td>
                        <td class="dp-col-right">${Math.round(distance)}m</td>
                        <td class="dp-col-center">${altBtn}</td>
                     </tr>`;
        }
        container.html(html);
    }

    self.panToPortal = function(guid) {
        let latLng = self.getLatLng(guid);
        if(latLng) window.map.panTo(latLng);
    }

    self.getPortalNameFromGUID = function(guid) {
        let portalData = self.allPortals[guid];
        if (portalData && portalData.title) {
            return portalData.title;
        }
        return "Unknown";
    };

    self.updateLayer = function() {
        if (self.plan && self.plan.furthestPath) {
            self.renderPlanTable(self.plan.furthestPath);
            self.drawLayer();
        } else {
            self.renderPlanTable(null);
        }
        $(".dp-loading").hide();
    };

    self.drawLayer = function() {
        self.clearLayers();
        let shortHopColor = $('#dp-color-short').val();
        let longHopColor = $('#dp-color-long').val();
        let fullTreeColor = $('#dp-color-tree').val();
        let longHopThreshold = self.getLongHopThreshold();

        function getStyle(distance, isTree) {
            return {
                color: isTree ? fullTreeColor : distance > longHopThreshold ? longHopColor : shortHopColor,
                opacity: 1,
                weight: isTree ? 1.5 : 4.5,
                clickable: false,
                interactive: false,
                dashArray: [12, 5, 4, 5, 6, 5, 8, 5, "100000"],
            };
        }

        // Draw start portal highlight (Yellow)
        if (self.startPortal && self.startPortal.guid) {
            let latLng = self.getLatLng(self.startPortal.guid);
            if (latLng) {
                L.circleMarker(latLng, {
                    radius: 12,
                    stroke: true,
                    color: '#FFFF00',
                    weight: 3,
                    opacity: 1,
                    fill: true,
                    fillColor: '#FFFF00',
                    fillOpacity: 0.1,
                    interactive: false,
                    clickable: false
                }).addTo(self.highlightLayergroup);
            }
        }

        // Draw Tree
        for (let guid in self.plan) {
            if (self.plan[guid] && self.plan[guid].parent) {
                let startLatLng = self.getLatLng(guid);
                let endLatLng = self.getLatLng(self.plan[guid].parent);
                let distance = self.getDistance(guid, self.plan[guid].parent);
                self.drawLine(self.linksLayerGroup, startLatLng, endLatLng, getStyle(distance, true));
            }
        }
        // Draw Path
        if (self.plan && self.plan.furthestPath) {
            for (let i = 0; i < self.plan.furthestPath.length - 1; i++) {
                let startLatLng = self.getLatLng(self.plan.furthestPath[i]);
                let endLatLng = self.getLatLng(self.plan.furthestPath[i + 1]);
                let distance = self.getDistance(self.plan.furthestPath[i], self.plan.furthestPath[i + 1]);
                self.drawLine(self.fieldsLayerGroup, startLatLng, endLatLng, getStyle(distance, false));
            }
        }
    };

    self.resetAll = function() {
        self.clearLayers();
        self.startPortal = null;
        self.plan = null;
        self.allPortals = {};
        self.graph = {};
        self.userBlockedNodes.clear();
        self.saveData();
        self.renderPlanTable(null);
    }

    self.setup = function() {
        self.setupCSS();
        
        self.linksLayerGroup = new L.LayerGroup();
        window.addLayerGroup('Drone Paths (Tree)', self.linksLayerGroup, false);

        self.fieldsLayerGroup = new L.LayerGroup();
        window.addLayerGroup('Drone Flight Path', self.fieldsLayerGroup, true);
        
        self.highlightLayergroup = new L.LayerGroup();
        window.addLayerGroup('Drone Highlights', self.highlightLayergroup, true);

        self.coverageLayerGroup = new L.LayerGroup();
        window.addLayerGroup('Drone Scan Coverage', self.coverageLayerGroup, true);

        $('#toolbox').append('<a onclick="window.plugin.dronePlanner.openDialog(); return false;">Plan Drone Flight</a>');
        
        window.addHook('portalSelected', self.portalSelected);
        
        // Auto-Explorer / Coverage map listener
        window.map.on('moveend', function() {
            self.drawCoverage(); // Ensure rectangles stay visible on pan/zoom
        });

        window.map.on('overlayadd overlayremove', function() {
            setTimeout(function(){ self.updateLayer(); self.drawCoverage(); },1);
        });
    };

    self.clearLayers = function() {
        if (self.linksLayerGroup) self.linksLayerGroup.clearLayers();
        if (self.fieldsLayerGroup) self.fieldsLayerGroup.clearLayers();
        if (self.highlightLayergroup) self.highlightLayergroup.clearLayers();
        if (self.coverageLayerGroup) self.coverageLayerGroup.clearLayers();
    }

    self.drawLine = function(layerGroup, alatlng, blatlng, style) {
        if (window.map.hasLayer(layerGroup)) {
            L.polyline([alatlng, blatlng], style).addTo(layerGroup);
        }
    }

    self.portalSelected = function(data) {
        if (!self.dialogIsOpen()) return;
        if (!self.isSettingOrigin) return; // Only allow selection if button clicked

        let guid = data.selectedPortalGuid;
        let p = self.allPortals[guid];

        // 1. Immediate Visual Feedback
        $(".dp-loading").text("Setting Origin & Calculating...").show();
        $("#dp-btn-set-origin").removeClass("active").text("Set Origin Portal");
        self.isSettingOrigin = false;

        if (!p) {
             let iitcPortal = window.portals[guid];
             if (iitcPortal) {
                 p = iitcPortal.options.data;
                 self.addPortalToGraph(guid, p);
             }
        }

        if (!p) {
            $(".dp-loading").hide();
            return;
        }

        self.startPortal = { guid: guid, details: p };
        self.updateUIHUD(); // Update the yellow Origin label immediately
        
        self.saveData();
        
        // Use a short timeout to let the UI render the loading state before heavy calc
        setTimeout(() => {
            self.updatePlan(true); 
        }, 10);
    };

    // --- HTML TEMPLATE ---
    self.dialog_html = `
        <div id="dp-dialog">
            <div class="dp-loading">Loading...</div>
            <div class="dp-list-container">
                <table class="dp-table">
                    <thead>
                        <tr>
                            <th style="width:30px">#</th>
                            <th style="width:30px">Dir</th>
                            <th style="width:30px">Fac</th>
                            <th>Portal Name</th>
                            <th class="dp-col-right" style="width:60px">Dist</th>
                            <th class="dp-col-center" style="width:40px">Act</th>
                        </tr>
                    </thead>
                    <tbody id="dp-plan-body"></tbody>
                </table>
            </div>
            
            <div class="dp-controls">
                <div class="dp-group">
                    <span class="dp-group-title">Portals Data</span>
                    <div class="dp-row" style="margin-bottom:8px">
                        <label>Mode:</label>
                        <select id="dp-scan-mode" style="background:#333; color:#fff; border:1px solid #555;">
                            <option value="single" selected>Current View Only</option>
                            <option value="extended">Extended Cache</option>
                        </select>
                    </div>
                    <div class="dp-player">
                        <button class="dp-player-btn dp-btn-rec" id="dp-btn-record" title="Record Portals in Current View. PLEASE WAIT for the map to finish loading all portals before clicking.">▶ Scan</button>
                        <button class="dp-player-btn dp-btn-reset" id="dp-btn-reset-all" title="Reset Everything (Cache, Origin, Plan, Avoids)">⟲ Reset All</button>
                    </div>
                    <div class="dp-hud">
                        <span class="dp-hud-label">Portals:</span> <span id="dp-hud-portals">0</span><br>
                        <span class="dp-hud-label">Scans:</span> <span id="dp-hud-scans">0</span>
                    </div>
                    <div class="dp-row">
                        <label title="Show coverage areas on map."><input type="checkbox" id="dp-show-coverage" checked> Show Coverage</label>
                    </div>
                </div>

                <div class="dp-group">
                    <span class="dp-group-title">Flight Planning</span>
                    <div class="dp-hud" style="color: #ff0; margin-bottom:8px">
                        <span class="dp-hud-label">Origin:</span> <span id="dp-hud-origin">None</span>
                    </div>
                    <button class="dp-player-btn dp-btn-origin" id="dp-btn-set-origin" title="Click this button, then click a portal on the map to set it as the flight origin.">Set Origin Portal</button>
                    <div style="margin-top:8px" id="dp-calc-container">
                        <button class="dp-btn-main" id="dp-btn-calculate" disabled title="Manual calculation is required in Extended mode after adding data or changing origin.">Calculate Flight Plan</button>
                    </div>
                    <div id="dp-stats" style="margin-top:5px"></div>
                </div>

                <div class="dp-group">
                    <span class="dp-group-title">Flight Strategy</span>
                    <div class="dp-row"><label title="Targets the absolute furthest reachable portal using the most efficient path. Best for making overall progress."><input type="radio" name="dp-strategy" id="opt-distance" value="distance" checked> Target: Furthest Portal</label></div>
                    <div class="dp-row"><label title="Prioritizes visiting as many unique portals as possible. Best for exploration stats, but may move in zig-zags."><input type="radio" name="dp-strategy" id="opt-max-unique" value="max-unique"> Target: Exploration</label></div>
                    <div class="dp-row"><label title="Visits the nearest portals first to maximize hacks in a small area. Pros: High volume. Cons: Very slow progress."><input type="radio" name="dp-strategy" id="opt-farming" value="farming"> Target: Dense Farming</label></div>
                </div>

                <div class="dp-group">
                    <span class="dp-group-title">Flight Optimization</span>
                    <div class="dp-row">
                        <label>Priority:</label>
                        <select id="dp-path-type" style="background:#333; color:#fff; border:1px solid #555; width:110px;">
                            <option value="min-long-hops">Short Hops (Safe)</option>
                            <option value="min-hops">Long Hops (Fastest)</option>
                            <option value="balanced">Balanced</option>
                        </select>
                    </div>
                    <div class="dp-row">
                        <label>Allow Long Hops:</label>
                        <div>
                            <label><input type="radio" name="dp-allow-long" value="yes"> Yes</label>
                            <label><input type="radio" name="dp-allow-long" value="no" checked> No</label>
                        </div>
                    </div>
                    <div class="dp-row">
                        <label title="Distance limit for a single move (no keys). Standard is 500m.">Hop Limit (m):</label>
                        <input type="number" id="dp-hop-length" class="dp-input-sm" value="500" step="10" min="50" max="2000">
                    </div>
                </div>

                <div class="dp-group">
                    <span class="dp-group-title">Appearance</span>
                    <div class="dp-row">
                        <label>Short Hop:</label>
                        <input type="color" id="dp-color-short" class="dp-color-input" value="#cc44ff" title="Safe jumps (No key)">
                    </div>
                    <div class="dp-row">
                        <label>Long Hop:</label>
                        <input type="color" id="dp-color-long" class="dp-color-input" value="#ff0000" title="Key required">
                    </div>
                    <div class="dp-row">
                        <label>Tree:</label>
                        <input type="color" id="dp-color-tree" class="dp-color-input" value="#ffcc44" title="All reachable nodes">
                    </div>
                </div>

                <div class="dp-group">
                    <span class="dp-group-title">Export / Manage</span>
                    <div class="dp-btn dp-btn-action dp-btn-sm" id="dp-btn-clear-blocked" style="margin-bottom:4px">Clear Avoided Portals</div>
                    <div class="dp-btn dp-btn-action dp-btn-sm" id="dp-btn-drawtools" style="margin-bottom:4px">Save to DrawTools</div>
                    <div class="dp-btn dp-btn-action dp-btn-sm" id="dp-btn-copy" style="margin-bottom:4px">Copy Steps</div>
                </div>
            </div>
        </div>
    `;

    self.openDialog = function() {
        if (!self.dialogIsOpen()) {
            dialog({
                title: `Drone Flight Planner v${self.PLUGIN_VERSION}`,
                id: 'dp-plugin-dialog',
                html: self.dialog_html,
                width: 700,
                height: 500,
                minHeight: 400,
                minWidth: 500
            });
            self.loadData();
            self.updateUIHUD(); // Ensure UI reflects loaded data immediately
            self.attachEventHandlers();
        }
    };

    self.attachEventHandlers = function() {
        $('#dp-btn-record').click(() => {
            if (window.map.getZoom() < 15) {
                alert("Zoom in further (Zoom 15+) to ensure all portals are recorded.");
                return;
            }
            
            let mode = $("#dp-scan-mode").val();
            if (mode === "single") {
                // Current View Only: Full reset before scan
                self.allPortals = {};
                self.graph = {};
                self.scannedAreas = [];
                self.startPortal = null;
                self.plan = null;
                self.clearLayers();
            }
            self.scanPortalsAndUpdateGraph();
        });

        $('#dp-btn-set-origin').click(() => {
            self.isSettingOrigin = true;
            $("#dp-btn-set-origin").addClass("active").text("Click Portal on Map...");
        });

        $('#dp-btn-calculate').click(() => self.updatePlan(true));

        $('#dp-btn-reset-all').click(() => {
            if(confirm("This will clear ALL cached portals, your origin, and your current plan. Proceed?")) {
                self.scannedAreas = [];
                self.resetAll();
                self.drawCoverage();
                self.updateUIHUD();
            }
        });

        $('#dp-btn-copy').click(() => self.copyPlanToClipboard());
        $('#dp-btn-drawtools').click(() => self.exportToDrawtools(self.plan));
        $('#dp-btn-clear-blocked').click(() => { 
            self.userBlockedNodes.clear(); 
            self.saveData(); 
            self.updatePlan(true); 
            alert("Blocked portals cleared."); 
        });

        // Config Changes
        $('input[name="dp-strategy"]').change(() => { self.saveData(); self.updatePlan(); });
        $('#dp-path-type').change(() => { self.saveData(); self.updatePlan(); });
        $('input[name="dp-allow-long"]').change(() => { self.saveData(); self.updatePlan(); });
        $('#dp-hop-length').on('change input', () => { self.saveData(); self.updatePlan(); });
        $('#dp-scan-mode').change(() => self.updateUIHUD());
        
        // Colors
        $('#dp-color-short, #dp-color-long, #dp-color-tree').change(() => { self.saveData(); self.drawLayer(); });

        // Exploration Toggles
        $('#dp-show-coverage').change(() => self.drawCoverage());

        // Dynamic Table Clicks
        $('#dp-plan-body').on('click', '.dp-step-name', function() {
            let guid = $(this).data('guid');
            self.panToPortal(guid);
        });
        $('#dp-plan-body').on('mouseenter', 'tr', function() {
            let guid = $(this).find('.dp-step-name').data('guid');
            self.highlightStep(guid, true);
        });
        $('#dp-plan-body').on('mouseleave', function() {
            self.highlightStep(null, false);
        });
        $('#dp-plan-body').on('click', '.dp-btn-alt', function() {
            let guid = $(this).data('guid');
            self.blockAndReroute(guid);
        });
    };

    self.dialogIsOpen = function() {
        return ($("#dialog-dp-plugin-dialog").length > 0);
    };

    self.getLatLng = function(guid) {
        let p = self.allPortals[guid];
        if (p) {
            // Ensure we return a real Leaflet object with methods like distanceTo
            if (p._ll && typeof p._ll.distanceTo === 'function') return p._ll;
            
            if (p.latE6) {
                p._ll = L.latLng(p.latE6 / 1e6, p.lngE6 / 1e6);
                return p._ll;
            }
            // Fallback if _ll was restored as a plain object from localStorage
            if (p._ll && p._ll.lat !== undefined) {
                p._ll = L.latLng(p._ll.lat, p._ll.lng);
                return p._ll;
            }
        }
        return null;
    };

    self.getDistance = function(guid1, guid2) {
        let ll1 = self.getLatLng(guid1);
        let ll2 = self.getLatLng(guid2);
        if (!ll1 || !ll2) return Infinity;
        if (typeof ll1.distanceTo !== 'function') {
            console.error("DronePlanner: Invalid LatLng object for", guid1, ll1);
            return Infinity;
        }
        return ll1.distanceTo(ll2);
    };

    self.highlightStep = function(guid, isHover) {
        if (!self.highlightLayergroup) return;
        self.highlightLayergroup.clearLayers();
        
        // Re-draw permanent start highlight if it exists
        if (self.startPortal && self.startPortal.guid) {
            let startLL = self.getLatLng(self.startPortal.guid);
            if (startLL) {
                L.circleMarker(startLL, {
                    radius: 12, stroke: true, color: '#FFFF00', weight: 3, opacity: 1, fill: true, fillColor: '#FFFF00', fillOpacity: 0.1, interactive: false
                }).addTo(self.highlightLayergroup);
            }
        }

        if (isHover && guid) {
            let ll = self.getLatLng(guid);
            if (ll) {
                L.circleMarker(ll, {
                    radius: 15, stroke: true, color: '#fff', weight: 4, opacity: 1, fill: false, interactive: false
                }).addTo(self.highlightLayergroup);
            }
        }
    };

    // --- Export Drawtools ---
    self.exportToDrawtools = function(plan) {
        if (typeof window.plugin.drawTools === 'undefined') return;
        if (!plan || !plan.furthestPath) return;
        
        let path = plan.furthestPath;
        let shortColor = $('#dp-color-short').val();
        let longColor = $('#dp-color-long').val();
        let threshold = self.getLongHopThreshold();

        for (var i=0; i<path.length-1; i++) {
            let p1 = self.getLatLng(path[i]);
            let p2 = self.getLatLng(path[i+1]);
            let dist = self.distance(p1, p2);
            let color = dist > threshold ? longColor : shortColor;
            
            let opts = {...window.plugin.drawTools.lineOptions};
            opts.color = color;
            
            let layer = L.geodesicPolyline([p1, p2], opts);
            window.plugin.drawTools.drawnItems.addLayer(layer);
        }
        window.plugin.drawTools.save();
        alert("Path saved to DrawTools.");
    }

    if (window.iitcLoaded && typeof self.setup === 'function') self.setup();
    else if (window.bootPlugins) window.bootPlugins.push(self.setup);
    else window.bootPlugins = [self.setup];
} 

var script = document.createElement('script');
var info = {};
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) {
    info.script = {
        version: GM_info.script.version,
        name: GM_info.script.name,
        description: GM_info.script.description
    };
}
var textContent = document.createTextNode('('+ wrapper +')('+ JSON.stringify(info) +')');
script.appendChild(textContent);
(document.body || document.head || document.documentElement).appendChild(script);
