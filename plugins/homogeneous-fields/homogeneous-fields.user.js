// ==UserScript==
// @id            iitc-plugin-homogeneous-fields@57Cell
// @name         IITC Plugin: Homogeneous Fields
// @version      1.2.0.20230628
// @description  Plugin for planning HCF in IITC
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

1.2.0.20230628
FIX: Some code refactoring to comply to IITC plugin framework.
FIX: typo in layer label fixed
NEW: improved dialog
NEW: User can now choose to generate a geometrically perfectly balanced plan

TODO: async field calculation

1.1.0.20230624
NEW: Added plugin layer and link drawings. (Heistergand)
NEW: Added numbers to the task list
FIX: minor code refactoring, mainly divorcing plan composing from UI drawing.

1.0.0.20230521
NEW: Initial Release (57Cell)

*/


const EARTH_RADIUS = 6371; // in km

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
        $('#toolbox').append('<a onclick="window.plugin.homogeneousFields.openDialog(); return false;">Plan HCF</a>');

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
        window.addLayerGroup('Homogeneous Fields', self.linksLayerGroup, false);
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
    self.findHCF = function(level, corners, portalsToConsider, mode) {
        // console.info('function findHCF start')
        if (level > 3) {
            console.log("In findHCF. level="+level+"  corners="+portalIdToObject(corners[0]).name+", "+ portalIdToObject(corners[1]).name+", "+ portalIdToObject(corners[2]).name);
        }
        if (level === 1) {
            // Base case: return a level 1 HCF
            return self.constructHCF(level, corners, null, []);
        }
        if (level > 1) {
            let portalsInTriangle = self.getPortalsInTriangle(corners, portalsToConsider);
            let candidates = Array.from(portalsInTriangle);  // create a copy of portalsInTriangle
            let attempt = 0;
            while (candidates.length > 0) {
                console.log(candidates.length+" candidate splitters to check")
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
                    let subHCF = self.findHCF(level - 1, subCorners, subTrianglePortals, mode);
                    if (subHCF === null) {
                        // Failed to construct sub-HCF
                        // Remove all portals from the failed triangle and the central splitter from the candidates
                        candidates = candidates.filter(portal => !subTrianglePortals.includes(portal) && portal !== central);
                        attempt++;
                        break;
                    }
                    subHCFs.push(subHCF);
                }

                if (subHCFs.length === 3) {
                    console.info('function findHCF: Successfully constructed all sub-HCFs')
                    // Successfully constructed all sub-HCFs
                    return self.constructHCF(level, corners, central, subHCFs);
                }
            }

            return null; // Failed to construct HCF after all candidates have been tried
        }
    };


    // Add this after the click event handler of "#find-hcf-plan-button"
    self.addHCFToDrawTools = function(hcf) {
        // return;
        if (window.plugin.drawTools === undefined) {
            return; // skip if drawtools is not installed
        }
        // TODO get this working
        /*
        // Add corner markers
        for (let corner of hcf.corners) {
            let cornerPortal = portalIdToObject(corner);
            let marker = new L.Marker(cornerPortal.latLng, {
                title: cornerPortal.name,
                icon: L.Icon.Default,
                zIndexOffset: 1000
            });
            window.plugin.drawTools.drawnItems.addLayer(marker);
        }

        // Add central marker (if any)
        if (hcf.central !== null) {
            let centralPortal = portalIdToObject(hcf.central);
            let marker = new L.Marker(centralPortal.latLng, {
                title: centralPortal.name,
                icon: L.Icon.Default,
                zIndexOffset: 1000
            });
            window.plugin.drawTools.drawnItems.addLayer(marker);
        }

        // Add links
        for (let corner1 of hcf.corners) {
            let portal1 = portalIdToObject(corner1);
            for (let corner2 of hcf.corners) {
                if (corner1 !== corner2) {
                    let portal2 = portalIdToObject(corner2);
                    let line = L.geodesicPolyline([portal1.latLng, portal2.latLng], {color: 'red'});
                    window.plugin.drawTools.drawnItems.addLayer(line);
                }
            }
            if (hcf.central !== null) {
                let portalC = portalIdToObject(hcf.central);
                let line = L.geodesicPolyline([portal1.latLng, portalC.latLng], {color: 'magenta'});
                window.plugin.drawTools.drawnItems.addLayer(line);
            }
        }
        window.plugin.drawTools.save();

        // Recursively add sub-HCFs
        for (let subHCF of hcf.subHCFs) {
            self.addHCFToDrawTools(subHCF);
        }
        */
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
    self.findShortestPath = function(portalData, path) {
        let disallowMatryoska = true; // TODO: make this a UI element
        let maxOutgoingLinksPermitted = 40; // TODO: put this in the UI
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
            if (newLength < bestLength && (!disallowMatryoska || !self.requiresMatryoskaLinks(portalData, newPath)) && maxLinks <= maxOutgoingLinksPermitted) {
                bestPath = newPath;
                bestLength = newLength;
            }
        }

        return bestPath;
    };


    self.planToText = function(plan) {
        let planText = "";
        let keysText = "\nKeys needed:\n";
        $.each(plan, function(index, item) {
            let pos = `${index + 1}`;
            if (item.action === 'capture') {
                planText += `${pos}. Capture ${item.portal.name}\n`;
            }
            else if (item.action === 'link') {
                planText += `${pos}. Link to ${item.portal.name}\n`;
            }
            else if (item.action === 'farmkeys') {
                keysText += `${item.portal.name}: ${item.keys}\n`;
            }
        });
        planText += keysText;
        return planText;
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

    // function to draw the plan to the plugin layer
    self.drawPlan = function(plan) {
        // initialize plugin layer
        if (window.map.hasLayer(self.linksLayerGroup)) {
            self.linksLayerGroup.clearLayers();
        }

        $.each(plan, function(index,planStep) {
            if (planStep.action === 'link') {
                let ll_from = planStep.fromPortal.latLng, ll_to = planStep.portal.latLng;
                self.drawLink(ll_from, ll_to, self.linkStyle);
            }
        });
    }

    // function to generate the final plan
    self.generatePlan = function(portalData, path, hcfLevel) {
        console.info('function generatePlan start');
        let plan = [];

        var stepNo = 0;
        // add the steps of the path
        for (let portalId of path) {
            // plan += `Capture ${portalData[portalId].name}\n`;
            plan.push({
                action: 'capture',
                stepNo: ++stepNo,
                portal: portalData[portalId]
            });

            let links = portalData[portalId].links;
            links.sort((a, b) => portalData[a].depth - portalData[b].depth);
            for (let linkId of links) {
                if (path.indexOf(linkId) < path.indexOf(portalId)) {
                    // plan += `Link to ${portalData[linkId].name}\n`;#
                    plan.push({
                        action: 'link',
                        stepNo: ++stepNo,
                        fromPortal: portalData[portalId],
                        portal: portalData[linkId],
                    });
                }
            }
        }

        // calculate the keys needed
        let keysNeeded = self.calculateKeysNeeded(portalData, path);

        // add the keys needed to the plan
        // plan += "\nKeys needed:\n";
        let portalNames = Object.keys(portalData).map(id => portalData[id].name);
        portalNames.sort();
        let totalKeysActual = 0;
        for (let name of portalNames) {
            let portalId = Object.keys(portalData).find(id => portalData[id].name === name);
            //plan += `${name}: ${keysNeeded[portalId]}\n`;
            plan.push({
                action: 'farmkeys',
                portal: portalData[portalId],
                keys: keysNeeded[portalId],
            });
            totalKeysActual += keysNeeded[portalId];
        }

        const totalPortalsExpected = (Math.pow(3, hcfLevel-1) + 5) / 2;
        const totalKeysExpected = (Math.pow(3, hcfLevel) + 3) / 2;
        const totalPortalsActual = portalNames.length;

        // Check if the total number of portals and keys match the expected values
        if (totalPortalsActual !== totalPortalsExpected || totalKeysActual !== totalKeysExpected) {
            console.log(hcfLevel, totalPortalsActual, totalPortalsExpected, totalKeysActual, totalKeysExpected, path, plan);
            // return 'Something went wrong. Wait for all portals to load, and try again.';
            return null;
        }
        console.info('function generatePlan: returning a plan');
        return plan;
    };


    // Attach click event to find-hcf-plan-button after the dialog is created
    self.openDialog = function() {
        dialog({
            title: 'HCF Plan View',
            id: 'dialog-hcf-plan-view',
            html: '<div id="hcf-portal-details">Choose three portals</div>\n' +

            '<fieldset style="margin: 2px;">\n'+
            '  <legend>Options</legend>\n'+
            '  <label for="layers">Layers: </label>\n' +
            '  <input type="number" id="layers" min="1" max="6" value="3"><br>\n' +

            '<br>'+
            '  <label for="hcf-mode">Mode: </label>\n' +

            '  <input type="radio" id="hcf-mode-random" name="hcf-mode" value="random" checked>\n' +
            '  <label for="hcf-mode-random" title="generate a geometrically randomised plan">Random</label>\n' +

            '  <input type="radio" id="hcf-mode-perfect" name="hcf-mode" value="perfect">\n' +
            '  <label for="hcf-mode-perfect" title="generate a geometrically perfectly balanced plan">Perfect</label>\n' +
            '<br>'+
            '</fieldset>\n'+

            '<button id="find-hcf-plan" style="margin: 2px;">Find HCF Plan</button><br>\n' +
            '<textarea readonly id="hcf-plan-text" style="height:200px;width:98%;margin:2px"></textarea>\n',
            width: '40%'
        });
        self.attachEventHandler();
    };

    self.plan = null;

    self.attachEventHandler = function() {
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

            let hcf = null;
            // Try to construct HCF
            $("#hcf-plan-text").val(`Calculating ${level} layers...`);
            try {
                hcf = self.findHCF(level, corners, null, mode);
            }
            finally {
                $("#hcf-plan-text").val("");
            }

            if (hcf === null) {
                $("#hcf-plan-text").val("No HCF found. Try fewer layers, or different portals.");
            } else {
                self.addHCFToDrawTools(hcf);

                // Generate portal data
                let portalData = self.generatePortalData(hcf);

                // Generate the initial path
                let t = Math.random() * 2 * Math.PI; // random angle in radians
                let initialPath = Object.keys(portalData).sort((a, b) => {
                    let aValue = portalData[a].latLng.lat * Math.cos(t) + portalData[a].latLng.lng * Math.sin(t);
                    let bValue = portalData[b].latLng.lat * Math.cos(t) + portalData[b].latLng.lng * Math.sin(t);
                    return aValue - bValue;
                }); // the "sweep" method: see https://youtu.be/iH0JMfR7BTI

                // Find a shorter path
                let shortestPath = self.findShortestPath(portalData, initialPath);

                // Generate the plan
                self.plan = self.generatePlan(portalData, shortestPath, level);

                if (!self.plan) {
                    $("#hcf-plan-text").val('Something went wrong. Wait for all portals to load, and try again.');
                } else {
                    $("#hcf-plan-text").val(self.planToText(self.plan));
                    self.drawPlan(self.plan);
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
        portalDetailsDiv.append("<p>I'll generate an HCF plan with corners:<ul>");
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

        /*
        let toRadians = function(degrees) {
            return degrees * Math.PI / 180;
        };

        let R = 6371e3; // metres
        let φ1 = toRadians(portal1.lat);
        let φ2 = toRadians(portal2.lat);
        let Δφ = toRadians(portal2.lat - portal1.lat);
        let Δλ = toRadians(portal2.lng - portal1.lng);

        let a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        let c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
        */
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
