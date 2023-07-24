// ==UserScript==
// @id            iitc-plugin-homogeneous-fields@57Cell
// @name         IITC Plugin: 57Cell's Field Planner
// @version      2.0.1.20230723
// @description  Plugin for planning fields in IITC
// @author       57Cell (Michael Hartley) and ChatGPT 4.0
// @namespace      https://github.com/jonatkins/ingress-intel-total-conversion
// @updateURL      https://github.com/mike40033/iitc-57Cell/raw/master/plugins/homogeneous-fields/homogeneous-fields.meta.js
// @downloadURL    https://github.com/mike40033/iitc-57Cell/raw/master/plugins/homogeneous-fields/homogeneous-fields.user.js
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

/** Version History

2.0.1.20230723
NEW: Add field drawing layer (Heistergand)
NEW: Created Control Fields are mentioned in the plan (Heistergand)
NEW: Add Statistics output (Heistergand)

2.0.0.20230723
NEW: Add an option for general maximum fielding (57Cell)
NEW: change name of plugin and UI text (57Cell)

1.2.3.20230723
NEW: Number of softbanks is noted for portals that need them (57Cell)

1.2.2.20230715
FIX: Sporadic failure to find an HCF when one exists (Issue #11)

1.2.1.20230701
FIX: Working with portals having the same name is no problem anymore.
NEW: Export to DrawTools (Heistergand)

1.2.0.20230628
FIX: Some code refactoring to comply to IITC plugin framework.
FIX: typo in layer label fixed
NEW: improved dialog (Heistergand)
NEW: User can now choose to generate a geometrically perfectly balanced plan

TODO: async field calculation

1.1.0.20230624
NEW: Added plugin layer and link drawings. (Heistergand)
NEW: Added numbers to the task list (Heistergand)
FIX: minor code refactoring, mainly divorcing plan composing from UI drawing.

1.0.0.20230521
NEW: Initial Release (57Cell)

*/

function wrapper(plugin_info) {
    if (typeof window.plugin !== 'function') window.plugin = function() {};

    // PLUGIN START
    let self = window.plugin.homogeneousFields = function() {};

    // helper function to convert portal ID to portal object
    function portalIdToObject(portalId) {
        let portals = window.portals; // IITC global object that contains all portal data
        let portal = portals[portalId] ? portals[portalId].options.data : null;

        // Convert portal to the structure expected by populatePortalData
        if (portal) {
            let lat = parseFloat(portal.latE6 / 1e6);
            let lng = parseFloat(portal.lngE6 / 1e6);
            return {
                id: portalId, // ID of the portal
                name: portal.title, // title of the portal
                latLng: new L.latLng(lat,lng), // use LatLng Class to stay more flexible
            };
        }

        return null;
    }

    // Global variables for selected portals
    self.selectedPortals = [];
    self.selectedPortalDetails = [];

    // layerGroup for the draws
    self.linksLayerGroup = null;
    self.fieldsLayerGroup = null;

    // TODO: make linkStyle editable in options dialog
    self.linkStyle = {
        color: '#FF0000',
        opacity: 1,
        weight: 1.5,
        clickable: false,
        interactive: false,
        smoothFactor: 10,
        dashArray: [12, 5, 4, 5, 6, 5, 8, 5, "100000" ],
    };

    // TODO: make fieldStyle editable in options dialog
    self.fieldStyle = {
        stroke: false,
        fill: true,
        fillColor: '#FF0000',
        fillOpacity: 0.1,
        clickable: false,
        interactive: false,
    };

    // Add this after your global variables
    self.HCF = function(level, corners, central, subHCFs) {
        this.level = level;
        this.corners = corners;
        this.central = central;
        this.subHCFs = subHCFs;
    };

    self.updateLayer = function(){
        if (self.plan) {
            self.drawPlan(self.plan);
        }
    };

    self.setup = function() {
        // Add button to toolbox
        $('#toolbox').append('<a onclick="window.plugin.homogeneousFields.openDialog(); return false;">Plan Fields</a>');

        // Add styles
        $('head').append('<style>' +
                         '#dialog-hcf-plan-view {' +
                         '   width: 900px;' +
                         '   height: 800px;' +
                         '   overflow-y: auto;' +
                         '}' +
                         '</style>');

        // Add event listener for portal selection
        window.addHook('portalSelected', self.portalSelected);

        self.linksLayerGroup = new L.LayerGroup();
        window.addLayerGroup('Fielding Plan (Links)', self.linksLayerGroup, false);

        // window.addLayerGroup('Homogeneous CF Links', self.linksLayerGroup, false);

        self.fieldsLayerGroup = new L.LayerGroup();
        window.addLayerGroup('Fielding Plan (Fields)', self.fieldsLayerGroup, false);

        window.map.on('overlayadd overlayremove', function() {
            setTimeout(function(){
                self.updateLayer();
            },1);
        });
    };

    self.pointInTriangle = function(pt, triangle) {
        const convertTo3D = pt => {
            const lat = pt.lat * Math.PI / 180;
            const lng = pt.lng * Math.PI / 180;
            return {
                x: Math.cos(lat) * Math.cos(lng),
                y: Math.cos(lat) * Math.sin(lng),
                z: Math.sin(lat)
            };
        };

        const [p1, p2, p3] = triangle.map(convertTo3D);
        const pt3D = convertTo3D(pt);

        const v0 = self.vectorSubtract(p3, p1);
        const v1 = self.vectorSubtract(p2, p1);
        const v2 = self.vectorSubtract(pt3D, p1);

        const dot00 = self.dotProduct(v0, v0);
        const dot01 = self.dotProduct(v0, v1);
        const dot02 = self.dotProduct(v0, v2);
        const dot11 = self.dotProduct(v1, v1);
        const dot12 = self.dotProduct(v1, v2);

        const inverDeno = 1 / (dot00 * dot11 - dot01 * dot01);
        const eps = 1e-6;
        const u = (dot11 * dot02 - dot01 * dot12) * inverDeno;
        if (u <= eps || u >= 1-eps) return false;

        const v = (dot00 * dot12 - dot01 * dot02) * inverDeno;
        if (v <= eps || v >= 1-eps) return false;
        return u + v < 1-eps;
    };

    self.dotProduct = function(a, b) {
        return a.x * b.x + a.y * b.y + a.z * b.z;
    };

    self.vectorSubtract = function(a, b) {
        return {
            x: a.x - b.x,
            y: a.y - b.y,
            z: a.z - b.z
        };
    };

    // Add this after your setup function
    self.pointInTriangleOld = function(pt, triangle) {
        const [p1, p2, p3] = triangle;
        if (pt === null)
            return false;
        const dX = pt.lng;
        const dY = pt.lat;
        const dX21 = p3.lng - p2.lng;
        const dY12 = p2.lat - p3.lat;
        const D = dY12 * (p1.lng - p3.lng) + dX21 * (p1.lat - p3.lat);
        const s = (dY12 * (dX - p3.lng) + dX21 * (dY - p3.lat))/D;
        const t = ((p3.lat - p1.lat) * (dX - p3.lng) + (p1.lng - p3.lng) * (dY - p3.lat))/D;
        return s > 0 && t > 0 && (s + t) < 1;
    };

    self.getPortalsInTriangle = function(triangle, portalsToConsider) {
        // convert portal ids to lat/lng objects
        const triangleLatLngs = triangle.map(portalId => {
            const portal = portalIdToObject(portalId);
            return portal ? portal.latLng : null;
        });

        let portalsInTriangle = [];
        if (portalsToConsider == null) {
            portalsToConsider = Object.keys(window.portals)
        }
        for (let portalGuid of portalsToConsider) {
            let portal = window.portals[portalGuid];
            if (self.pointInTriangle(portal.getLatLng(), triangleLatLngs)) {
                portalsInTriangle.push(portalGuid);
            }
        }
        return portalsInTriangle;
    };

    // Add this after getPortalsInTriangle function
    self.findCentralSplitter = function(portalsInTriangle) {
        if (portalsInTriangle.length === 0) {
            return null;
        }
        let randomIndex = Math.floor(Math.random() * portalsInTriangle.length);
        return portalsInTriangle[randomIndex];
    };

    self.constructHCF = function(level, corners, central, subHCFs) {
        return new self.HCF(level, corners, central, subHCFs);
    };

    /** @function calculateCentroid
     * get the portal GUID which is nearest
     * to the centroid point of all given GUIDs.
     * @param {array} GUIDs List of portal GUIDs
     */
    self.calculateCentroid = function (GUIDs) {

        let sumLat = 0.0;
        let sumLng = 0.0;
        let list = [];

        for (let i = 0; i < GUIDs.length; i++) {
            let ll = window.portals[GUIDs[i]].getLatLng();
            list.push({
                GUID: GUIDs[i],
                ll: ll
            });
        }

        for (let i = 0; i < list.length; i++) {
            sumLat += list[i].ll.lat; // adds the x-coordinate
            sumLng += list[i].ll.lng; // adds the y-coordinate
        }

        let centroid = new L.LatLng(sumLat / GUIDs.length, sumLng / GUIDs.length);
        list.sort((a, b) => centroid.distanceTo(a.ll) - centroid.distanceTo(b.ll));

        return list[0].GUID;
    };



    /**
    * @function self.findHCF
    * @param {int} Level
    * @param {array} corners Array of Portal GUIDs
    * @param {array} portalsToConsider
    */
    self.findHCF = function(level, corners, portalsToConsider, mode, fieldType) {
        // console.info('function findHCF start')
        let portalsInTriangle = self.getPortalsInTriangle(corners, portalsToConsider);
        if ((level === 1 && fieldType == 'hcf') || (fieldType == 'general' && portalsInTriangle.length == 0)) {
            // Base case: return a level 1 HCF
            return self.constructHCF(level, corners, null, []);
        }
        if (level > 1) {
            let portalsNeeded = [-1,0,1,4,13,40,121];
            if (fieldType == 'hcf' && portalsInTriangle.length < portalsNeeded[level]) // not enough portals, fail immediately
                return null;
            let candidates = Array.from(portalsInTriangle);  // create a copy of portalsInTriangle
            let attempt = 0;
            while (candidates.length > 0) {
                let central = null;

                // Choose a central splitter

                if (mode === 'perfect') {
                    central = self.calculateCentroid(candidates);
                } else {
                    let centralIndex = Math.floor(Math.random() * candidates.length);
                    central = candidates[centralIndex];
                }

                let subHCFs = [];
                for (let i = 0; i < 3; i++) {
                    let subCorners = [corners[(i + attempt)%3], corners[(i + 1 + attempt) % 3], central];
                    let subTrianglePortals = self.getPortalsInTriangle(subCorners, portalsInTriangle);
                    let insufficientPortals = subTrianglePortals.length < portalsNeeded[level-1];
                    let subHCF = fieldType == 'hcf' && insufficientPortals ? null : self.findHCF(fieldType == 'hcf' ? level - 1 : level, subCorners, subTrianglePortals, mode, fieldType);
                    if (fieldType == 'hcf' && subHCF === null) {
                        // Failed to construct sub-HCF
                        if (insufficientPortals) {
                            // Remove all portals from the failed triangle and the central splitter from the candidates
                            candidates = candidates.filter(portal => !subTrianglePortals.includes(portal) && portal !== central);
                            attempt++;
                        } else {
                            // Remove just the failed central splitter (see Issue 11)
                            candidates = candidates.filter(portal => portal !== central);
                        }
                        break;
                    } 
                    subHCFs.push(subHCF);
                }

                if (subHCFs.length === 3) {
                    // Successfully constructed all sub-HCFs
                    return self.constructHCF(level, corners, central, subHCFs);
                }
            }

            return null; // Failed to construct HCF after all candidates have been tried
        }
    };

    // helper function to recursively populate the portal data structure
    function populatePortalData(portalData, hcf, depth) {
        // add corner portals
        for (let i = 0; i < hcf.corners.length; i++) {
            let portal = portalIdToObject(hcf.corners[i]);
            // create portal data if it doesn't exist yet
            if (!(portal.id in portalData)) {
                portalData[portal.id] = {
                    id: portal.id,
                    name: portal.name,
                    latLng: portal.latLng,
                    links: [],
                    coverings: [],
                    depth: depth
                };
            }

            // add links
            for (let j = i + 1; j < hcf.corners.length; j++) {
                if (!portalData[portal.id].links.includes(hcf.corners[j])) {
                    portalData[portal.id].links.push(hcf.corners[j]);
                }
            }
            if (hcf.central !== null) {
                if (!portalData[portal.id].links.includes(hcf.central)) {
                    portalData[portal.id].links.push(hcf.central);
                }
            }

        }

        // add central portal
        if (hcf.central !== null) {
            let portal = portalIdToObject(hcf.central);
            // create portal data if it doesn't exist yet
            if (!(portal.id in portalData)) {
                portalData[portal.id] = {
                    id: portal.id,
                    name: portal.name,
                    latLng: portal.latLng,
                    links: [],
                    coverings: hcf.corners,
                    depth: depth + 1
                };
            } else {
                portalData[portal.id].coverings = hcf.corners;
            }

            // add links
            for (let corner of hcf.corners) {
                if (!portalData[portal.id].links.includes(corner)) {
                    portalData[portal.id].links.push(corner);
                }
            }
        }

        // recursively add sub-HCFs
        for (let subHCF of hcf.subHCFs) {
            populatePortalData(portalData, subHCF, depth + 1);
        }
    }

    // function to generate the portal data structure
    self.generatePortalData = function(hcf) {
        let portalData = {};
        console.log(hcf);
        populatePortalData(portalData, hcf, 0);

        // post-processing step to ensure reflexivity of links
        for (let portalId in portalData) {
            let portal = portalData[portalId];
            for (let link of portal.links) {
                if (!portalData[link].links.includes(portalId)) {
                    portalData[link].links.push(portalId);
                }
            }
        }

        return portalData;
    };

    // function to calculate the keys needed for each portal in a path
    self.calculateKeysNeeded = function(portalData, path) {
        let keysNeeded = {};

        // initialize keys needed for each portal to zero
        for (let portalId of path) {
            keysNeeded[portalId] = 0;
        }

        // calculate keys needed
        for (let i = 0; i < path.length; i++) {
            let portalId = path[i];
            for (let linkId of portalData[portalId].links) {
                // only count links to portals that appear later in the path
                if (path.indexOf(linkId) > i) {
                    keysNeeded[portalId]++;
                }
            }
        }

        return keysNeeded;
    };

    // function to check if a path requires Matryoska links
    self.requiresMatryoskaLinks = function(portalData, path) {
        for (let i = 0; i < path.length; i++) {
            let portalId = path[i];
            if (portalData[portalId].coverings.length > 0 && portalData[portalId].coverings.every(id => path.indexOf(id) < i)) {
                return true;
            }
        }
        return false;
    };

    // function to calculate the total length of a path
    self.calculatePathLength = function(portalData, path) {
        let totalLength = 0;
        for (let i = 1; i < path.length; i++) {
            let portal1 = portalData[path[i - 1]].latLng;
            let portal2 = portalData[path[i]].latLng;
            totalLength += self.distance(portal1, portal2);
        }
        return totalLength;
    };

    // helper function to count the number of outgoing links from each portal in a path
    self.countOutgoingLinks = function(path, portalData) {
        let outgoingLinks = {};
        for (let id of path) {
            let links = portalData[id].links;
            for (let linkId of links) {
                if (path.indexOf(linkId) < path.indexOf(id)) {
                    if (id in outgoingLinks) {
                        outgoingLinks[id]++;
                    } else {
                        outgoingLinks[id] = 1;
                    }
                }
            }
        }
        return outgoingLinks;
    };

    // optimization algorithm to find the shortest path
    self.findShortestPath = function(portalData, path, fieldType) {
        let disallowMatryoska = true; // TODO: make this a UI element
        let maxOutgoingLinksPermitted = 40; // TODO: put this in the UI
        let initialOutgoingLinks = self.countOutgoingLinks(path, portalData);
        let leastMaxOutgoingLinks = Math.max(...Object.values(initialOutgoingLinks))
        let bestPath = path.slice();
        let bestLength = self.calculatePathLength(portalData, bestPath);

        for (let i = 0; i < path.length*path.length; i++) {
            // create a copy of the path
            let newPath = bestPath.slice();

            // decide which operation to perform
            let operation = Math.floor(Math.random() * 4);
            if (operation === 0) {
                // swap two random elements
                let index1 = Math.floor(Math.random() * newPath.length);
                let index2 = Math.floor(Math.random() * newPath.length);
                [newPath[index1], newPath[index2]] = [newPath[index2], newPath[index1]];
            } else if (operation === 1) {
                // swap two adjacent elements
                let index = Math.floor(Math.random() * (newPath.length - 1));
                [newPath[index], newPath[index + 1]] = [newPath[index + 1], newPath[index]];
            } else if (operation === 2) {
                // reverse a section of the path
                let index1 = Math.floor(Math.random() * newPath.length);
                let index2 = Math.floor(Math.random() * newPath.length);
                if (index1 > index2) [index1, index2] = [index2, index1]; // ensure index1 <= index2
                newPath = newPath.slice(0, index1)
                    .concat(newPath.slice(index1, index2 + 1).reverse())
                    .concat(newPath.slice(index2 + 1));
            } else {
                // slide a section of the path to a different position
                let index1 = Math.floor(Math.random() * newPath.length);
                let index2 = Math.floor(Math.random() * newPath.length);
                let slideTo = Math.floor(Math.random() * newPath.length);
                if (index1 > index2) [index1, index2] = [index2, index1]; // ensure index1 <= index2
                let chunk = newPath.splice(index1, index2 - index1 + 1); // remove the chunk from the path
                newPath.splice(slideTo, 0, ...chunk); // insert the chunk at the new position
            }

            // only keep the changes if they improve the total length and meet the constraints
            let newLength = self.calculatePathLength(portalData, newPath);
            let outgoingLinks = self.countOutgoingLinks(newPath, portalData);
            let maxLinks = Math.max(...Object.values(outgoingLinks));
            if (maxLinks < leastMaxOutgoingLinks) {
                leastMaxOutgoingLinks = maxLinks;
            }
            // keep the path if all of the following are true:
            // (a) it's shorter, 
            // (b) it doesn't need Matryoska links OR Matryoska links are allowed, 
            // (c) it doesn't exceed outgoing link limits, unless we haven't been able to meet those limits
            if (newLength < bestLength 
                && (!disallowMatryoska || !self.requiresMatryoskaLinks(portalData, newPath))
                && maxLinks <= Math.max(maxOutgoingLinksPermitted, leastMaxOutgoingLinks)) {
                bestPath = newPath;
                bestLength = newLength;
            }
        }

        return bestPath;
    };


    self.planToText = function(plan) {
        const nextChar = function(c) {
            return c === 'z' ? 'A' : String.fromCharCode(c.charCodeAt(0) + 1);
        }

        let maxSBUL = plan.reduce((max, item) => Math.max(max, item.sbul || 0), 0);
        let planText = "", sbulText = "";
        if (maxSBUL > 4)
            return "Sadly, the best plan I found still needs "+maxSBUL+" softbanks on at least one portal. If you want me to try again, click 'Find Fielding Plan' again."
        if (maxSBUL > 2)
            planText = "Warning: this plan can't be done solo. One of its portals needs "+maxSBUL+" softbanks.\n\n"
        let stepPos = 0,
            linkPos = 'a';

        let keysText = "\nKeys needed:\n";
        let keypos = 0;

        let statsText = "\nStats:\n";
        let portalCount = 0, linkCount = 0, fieldCount = 0;

        $.each(plan, function(index, item) {
            // let pos = `${index + 1}`;
            if (item.action === 'capture') {
                portalCount++;
                sbulText = item.sbul === 0 ? "" : ` (${item.sbul} Softbank${(item.sbul == 1 ? "" : "s")})`;
                planText += `${++stepPos}.`.padStart(4, '\xa0') + ` Capture ${item.portal.name}${sbulText}\n`;
                linkPos = 'a';
            }
            else if (item.action === 'link') {
                linkCount++;
                // planText += `${stepPos}.${linkPos}:`.padStart(6, '\xa0') + ` Link to ${item.portal.name}\n`;
                planText += `${linkPos})`.padStart(7, '\xa0') + ` Link to ${item.portal.name}\n`;
                linkPos = nextChar(linkPos);
            }
            else if (item.action === 'field') {
                fieldCount++;
                planText += '→'.padStart(9, '\xa0') + ` Control Field with ${item.c.name}\n`;
            }
            else if (item.action === 'farmkeys') {
                keysText += `${++keypos})`.padStart(4, '\xa0') + ` ${item.portal.name}: ${item.keys}\n`;
            }
        });

        let indentation = 8;
        statsText +=
            "Portals".padEnd(indentation, '\xa0') + `: ${portalCount}\n` +
            "Links".padEnd(indentation, '\xa0') + `: ${linkCount}\n` +
            "Fields".padEnd(indentation, '\xa0') + `: ${fieldCount}\n`;


        planText += keysText + statsText;
        return planText;
    }

    self.clearLayers = function() {
        if (window.map.hasLayer(self.linksLayerGroup)) {
            self.linksLayerGroup.clearLayers();
        }
        if (window.map.hasLayer(self.fieldsLayerGroup)) {
            self.fieldsLayerGroup.clearLayers();
        }

    }

    // function to draw a link to the plugin layer
    self.drawLink = function (alatlng, blatlng, style) {
        //check if layer is active
        if (!window.map.hasLayer(self.linksLayerGroup)) {
            return;
        }

        var poly = L.polyline([alatlng, blatlng], style);
        poly.addTo(self.linksLayerGroup);

    }

    // function to draw a field to the plugin layer
    self.drawField = function (alatlng, blatlng, clatlng, style) {
        //check if layer is active
        if (!window.map.hasLayer(self.fieldsLayerGroup)) {
            return;
        }

        var poly = L.polygon([alatlng, blatlng, clatlng], style);
        poly.addTo(self.fieldsLayerGroup);

    }

    self.exportDrawtoolsLink = function(p1, p2) {
        let alatlng = p1.latLng;
        let blatlng = p2.latLng;
        let layer = L.geodesicPolyline([alatlng, blatlng], window.plugin.drawTools.lineOptions);
        window.plugin.drawTools.drawnItems.addLayer(layer);
        window.plugin.drawTools.save();

    }

    // function to draw the plan to the plugin layer
    self.drawPlan = function(plan) {
        // initialize plugin layer
        self.clearLayers();

        $.each(plan, function(index,planStep) {
            if (planStep.action === 'link') {
                let ll_from = planStep.fromPortal.latLng, ll_to = planStep.portal.latLng;
                self.drawLink(ll_from, ll_to, self.linkStyle);
            }
            if (planStep.action === 'field') {
                self.drawField(
                    planStep.a.latLng,
                    planStep.b.latLng,
                    planStep.c.latLng,
                    self.fieldStyle);
            }
        });
    }

    // function to export and draw the plan to the drawtools plugin layer
    self.exportToDrawtools = function(plan) {
        // initialize plugin layer
        if (window.plugin.drawTools !== 'undefined') {
            $.each(plan, function(index, planStep) {
                if (planStep.action === 'link') {
                    self.exportDrawtoolsLink(planStep.fromPortal, planStep.portal);
                }
            });
        }
    }

    // function to add a link to the arc plugin
    self.drawArc = function (p1, p2) {
        if(typeof window.plugin.arcs != 'undefined') {
            window.selectedPortal = p1.id;
            window.plugin.arcs.draw();
            window.selectedPortal = p2.id;
            window.plugin.arcs.draw();
        }
    }


    // function to export the plan to the arc plugin
    self.drawArcPlan = function(plan) {
        // initialize plugin layer
        if(typeof window.plugin.arcs !== 'undefined') {
            $.each(plan, function(index, planStep) {
                if (planStep.action === 'link') {
                    self.drawArc(planStep.fromPortal, planStep.portal);
                }
            });
        }
    }

    // function to generate the final plan
    self.generatePlan = function(portalData, path, hcfLevel, fieldType) {

        /** @function getThirds
          * Returns the list of portals, a new link a->b potentially(!) produces a field with.
          * Note that this fuction totally ignores bearing and size and can easily return multiple
          * fields on each side of the link.
          *
          * @param list {array} List of portal-tupels {a: {portal}, b: {portal}}
          * @param a {point} Point for a portal
          * @param b {point} Point for a portal
          * @return {array} of portals
          */
        const getThirds = function(list, newLink) {
            let a = newLink.fromPortal,
                b = newLink.toPortal,
                i, k,
                linksOnA = [],
                linksOnB = [],
                result = [];

            for (i in list) {
                let ll_a = list[i].a.latLng;
                let ll_b = list[i].b.latLng;

                if ((ll_a.equals(a.latLng) && ll_b.equals(b.latLng)) || (ll_a.equals(b.latLng) && ll_b.equals(a.latLng))) {
                    // link in list equals tested link
                    continue;
                }
                if (ll_a.equals(a.latLng) || ll_b.equals(a.latLng)) linksOnA.push(list[i]);
                if (ll_a.equals(b.latLng) || ll_b.equals(b.latLng)) linksOnB.push(list[i]);
            }
            for (i in linksOnA) {
                for (k in linksOnB) {
                    if (linksOnA[i].a.latLng.equals(linksOnB[k].a.latLng) || linksOnA[i].a.latLng.equals(linksOnB[k].b.latLng) )
                        result.push(linksOnA[i].a);
                    if (linksOnA[i].b.latLng.equals(linksOnB[k].a.latLng) || linksOnA[i].b.latLng.equals(linksOnB[k].b.latLng))
                        result.push(linksOnA[i].b);
                }
            }

            return result;
        }; // end getThirds

        let plan = [],
            allLinks = [],
            stepNo = 0;

        // add the steps of the path
        for (let portalId of path) {
            // plan += `Capture ${a.name}\n`;
            let a = portalData[portalId];
            let links = a.links;
            links.sort((n, m) => portalData[n].depth - portalData[m].depth);
            // calculate outgoing links and count softbanks
            let outgoingLinks = links.filter(linkId => path.indexOf(linkId) < path.indexOf(portalId));
            let sbul = outgoingLinks.length <= 8 ? 0 : Math.floor((outgoingLinks.length-1)/8);



            plan.push({
                action: 'capture',
                stepNo: ++stepNo,
                portal: a,
                sbul: sbul
            });

            for (let linkId of outgoingLinks) {
                // keep track of all links we've already made
                let b = portalData[linkId];
                allLinks.push({a: a, b: b});

                // plan += `Link to ${b.name}\n`;#
                plan.push({
                    action: 'link',
                    stepNo: ++stepNo,
                    fromPortal: a,
                    portal: b,
                });

                for (let thirdPortal of getThirds(allLinks, {
                    fromPortal: a,
                    toPortal: b,
                    guid: linkId,
                })) {
                    plan.push({
                        action: 'field',
                        stepNo: stepNo,
                        a: a,
                        b: b,
                        c: thirdPortal
                    });
                };
            }
        }

        // calculate the keys needed
        let keysNeeded = self.calculateKeysNeeded(portalData, path);

        let totalKeysActual = 0;
        $.each(portalData, function(portalId, portal) {
            plan.push({
                action: 'farmkeys',
                portal: portal,
                keys: keysNeeded[portalId],
            });
            totalKeysActual += keysNeeded[portalId];
        });

        if (fieldType == 'hcf') {
            const totalPortalsExpected = (Math.pow(3, hcfLevel-1) + 5) / 2;
            const totalKeysExpected = (Math.pow(3, hcfLevel) + 3) / 2;
            const totalPortalsActual = path.length;
            // Check if the total number of portals and keys match the expected values
            if (totalPortalsActual !== totalPortalsExpected || totalKeysActual !== totalKeysExpected) {
                console.log(hcfLevel, totalPortalsActual, totalPortalsExpected, totalKeysActual, totalKeysExpected, path, plan);
                // return 'Something went wrong. Wait for all portals to load, and try again.';
                return null;
            }
        }
        return plan;
    };


    // Attach click event to find-hcf-plan-button after the dialog is created
    self.openDialog = function() {
        dialog({
            title: 'Fielding Plan View',
            id: 'dialog-hcf-plan-view',
            html: '<div id="hcf-portal-details">Choose three portals</div>\n' +

            '<fieldset style="margin: 2px;">\n'+
            '<legend>Options</legend>\n'+
            '  <label for="field-type">Field type: </label>\n' +
            '  <input type="radio" id="field-type-hcf" name="field-type" value="hcf" checked>\n' +
            '  <label for="field-type-hcf" title="generate a homogeneous fielding plan">Homogeneous Fields</label>\n' +
            '  <input type="radio" id="field-type-general" name="field-type" value="general">\n' +
            '  <label for="field-type-general" title="generate a general maximum fielding plan">General Maximum Fielding</label>\n' +
            '<br>'+
            '  <label for="hcf-mode">Geometry: </label>\n' +
            '  <input type="radio" id="hcf-mode-random" name="hcf-mode" value="random" checked>\n' +
            '  <label for="hcf-mode-random" title="generate a geometrically randomised plan">Random</label>\n' +
            '  <input type="radio" id="hcf-mode-perfect" name="hcf-mode" value="perfect">\n' +
            '  <label for="hcf-mode-perfect" title="generate a geometrically perfectly balanced plan">Perfect</label>\n' +
            '<br>'+
            '  <div id="layers-container">\n' +
            '    <label for="layers">Layers: </label>\n' +
            '    <input type="number" id="layers" min="1" max="6" value="3"><br>\n' +
            '  </div>\n' +
            '</fieldset>\n' +

            '<button id="find-hcf-plan" style="margin: 2px;">Find Fielding Plan</button>'+
            '<button id="hcf-to-dt-btn" hidden>Export to DrawTools</button>'+
            '<button id="hcf-to-arc-btn" hidden>Export to Arc</button>'+
            '<br>\n' +
            '<textarea readonly id="hcf-plan-text" style="height:200px;width:98%;margin:2px"></textarea>\n',
            width: '40%'
        });
        self.attachEventHandler();
    };

    self.plan = null;

    self.attachEventHandler = function() {
        $("#hcf-to-arc-btn").click(function() {
            self.drawArcPlan(self.plan);
            window.plugin.arcs.list();
        });

        $("#field-type-general").change(function() {
            if ($(this).is(":checked")) {
                $("#layers-container").css("display", "none");
            }
        });

        $("#field-type-hcf").change(function() {
            if ($(this).is(":checked")) {
                $("#layers-container").css("display", "block");
            }
        });

        $("#hcf-to-dt-btn").click(function() {
            self.exportToDrawtools(self.plan);
        });

        $("#find-hcf-plan").mousedown(function() {
            // Clear text field
            // setTimeout($("#hcf-plan-text").val("Please wait..."), 1);
            $("#hcf-plan-text").val("Please wait...");
        });

        $("#find-hcf-plan").click(function() {

            // Get selected portals and desired level
            let corners = self.selectedPortals;

            // If not enough portals have been selected, show an error and return
            if (corners.length < 3) {
                $("#hcf-plan-text").val("Please select at least three portals.");
                return;
            }
            let level = parseInt($("#layers").val());
            let mode = $( "input[type=radio][name=hcf-mode]:checked" ).val();
            let fieldType = $( "input[type=radio][name=field-type]:checked" ).val();

            let hcf = null;
            // Try to construct HCF
            $("#hcf-plan-text").val(`Calculating ${level} layers...`);
            try {
                hcf = self.findHCF(level, corners, null, mode, fieldType);
            }
            finally {
                $("#hcf-plan-text").val("");
            }

            if (hcf === null) {
                $("#hcf-plan-text").val("No HCF found. Try fewer layers, or different portals.");
            } else {
                // Generate portal data
                let portalData = self.generatePortalData(hcf);
                // let fieldData = self.generateFieldData(hcf);

                // Generate the initial path
                let t = Math.random() * 2 * Math.PI; // random angle in radians
                let initialPath = Object.keys(portalData).sort((a, b) => {
                    let aValue = portalData[a].latLng.lat * Math.cos(t) + portalData[a].latLng.lng * Math.sin(t);
                    let bValue = portalData[b].latLng.lat * Math.cos(t) + portalData[b].latLng.lng * Math.sin(t);
                    return aValue - bValue;
                }); // the "sweep" method: see https://youtu.be/iH0JMfR7BTI

                // Find a shorter path
                let shortestPath = self.findShortestPath(portalData, initialPath, fieldType);

                // Generate the plan
                self.plan = null;
                self.plan = self.generatePlan(portalData, shortestPath, level, fieldType);

                if (!self.plan) {
                    $("#hcf-plan-text").val('Something went wrong. Wait for all portals to load, and try again.');
                } else {
                    $("#hcf-plan-text").val(self.planToText(self.plan));
                    self.drawPlan(self.plan);

                    if(typeof window.plugin.drawTools !== 'undefined') {
                        $("#hcf-to-dt-btn").show();
                    };

                    // don't tell anyone:
                    if(typeof window.plugin.arcs !== 'undefined' && false ) {
                        $("#hcf-to-arc-btn").show();
                    };
                }
            }
        });
    }


    self.portalSelected = function(data) {
        // Ignore if already selected
        let portalDetails = window.portalDetail.get(data.selectedPortalGuid);
        if (portalDetails === undefined) return;
        if (self.selectedPortals.includes(data.selectedPortalGuid)) return;

        // Add selected portal to list
        self.selectedPortals.push(data.selectedPortalGuid);
        while (self.selectedPortals.length > 3) {
            self.selectedPortals.shift(); // remove the first item
        }
        // Retrieve portal details
        self.selectedPortalDetails.push(portalDetails);
        while (self.selectedPortalDetails.length > 3) {
            self.selectedPortalDetails.shift(); // remove the first item
        }
        self.updateDialog();
    };

    self.updateDialog = function() {
        // Update portal details in dialog
        let portalDetailsDiv = $('#hcf-portal-details');
        portalDetailsDiv.empty();
        portalDetailsDiv.append("<p>I'll generate a fielding plan with corners:<ul>");
        for (let portalDetails of self.selectedPortalDetails) {
            portalDetailsDiv.append('<li>' + portalDetails.title + '</li>');
        }
        if (self.selectedPortalDetails.length < 3) {
            portalDetailsDiv.append('<li>Please select ' + (3-self.selectedPortalDetails.length) + ' more</li>');
        }
        portalDetailsDiv.append('</ul>');

        // Enable "Find HCF Plan" button if three portals have been selected
        if (self.selectedPortals.length === 3) {
            $('#find-hcf-plan').prop('disabled', false);
        }
    };

    // Add this after countKeys function
    self.distance = function(portal1, portal2) {
        return portal1.distanceTo(portal2);
    };

    // PLUGIN END



    // Add an info property for IITC's plugin system
    var setup = self.setup;
    setup.info = plugin_info;

    // Make sure window.bootPlugins exists and is an array
    if (!window.bootPlugins) window.bootPlugins = [];
    // Add our startup hook
    window.bootPlugins.push(setup);
    // If IITC has already booted, immediately run the 'setup' function
    if (window.iitcLoaded && typeof setup === 'function') setup();

} // wrapper end

/*
// Setup wrapper, if not already done
if (window.plugin.homogeneousFields === undefined) {
  wrapper();
}

if (window.iitcLoaded) {
  window.plugin.homogeneousFields.setup();
} else {
  window.addHook('iitcLoaded', window.plugin.homogeneousFields.setup);
}
 */
// Create a script element to hold our content script
var script = document.createElement('script');
var info = {};

// GM_info is defined by the assorted monkey-themed browser extensions
// and holds information parsed from the script header.
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) {
    info.script = {
        version: GM_info.script.version,
        name: GM_info.script.name,
        description: GM_info.script.description
    };
}

// Create a text node and our IIFE inside of it
var textContent = document.createTextNode('('+ wrapper +')('+ JSON.stringify(info) +')');
// Add some content to the script element
script.appendChild(textContent);
// Finally, inject it... wherever.
(document.body || document.head || document.documentElement).appendChild(script);
