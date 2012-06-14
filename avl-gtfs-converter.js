/*jslint node: true, indent: 2, sloppy: true, white: true, vars: true */

/* Use the processed GTFS data and the AVL DB's static data to create lookup
 * tables for trip IDs and geo node IDs (stop IDs). We use the lookup table to
 * quickly convert AVL trip IDs to GTFS trip IDs and AVL geo node IDs to GTFS
 * stop IDs.
 * We only need to apply this once a day (probably less often).
 */

module.exports = (function () {
  var self = {};

  // This returns a function that should be called on each row of AVL trip data
  // to return a mapping from AVL trip IDs to GTFS trip IDs.
  // endTime is in seconds since midnight of the current transit day (not
  // calendar day)
  self.getTripMapBuilder = function(startNodeMap) {
    var tripMap = {};

    // Build the mapping between AVL trip IDs and GTFS trip IDs.
    // Each invocation returns the latest map. When the function has been
    // called on all of the data, the map is ready to use.
    return function buildTripMap(avlTripId, startNode, endNode, endTime) {
      var endNodeMap = startNodeMap[startNode];
      if (endNodeMap === undefined) {
        console.log('AVL Trip ID: ' + avlTripId);
        console.log('No entry for start node: ' + startNode);
        return tripMap;
      }
      var endTimeMap = endNodeMap[endNode];
      if (endTimeMap === undefined) {
        console.log('AVL Trip ID: ' + avlTripId);
        console.log('No entry for start node: ' + startNode +
                    ' and end node: ' + endNode);
        return tripMap;
      }
      var gtfsTripId = endTimeMap[endTime];
      if (gtfsTripId === undefined) {
        console.log('AVL Trip ID: ' + avlTripId);
        console.log('No entry for start node: ' + startNode +
                    ', end node: ' + endNode +
                    ', and end time: ' + endTime);
        return tripMap;
      }
      tripMap[avlTripId] = gtfsTripId;
      return tripMap;
    };
  };


  // This returns a function that should be called on each row of GTFS stop
  // data to return a mapping from AVL stop IDs to GTFS stop IDs.
  self.getStopMapBuilder = function(gtfsStopNameMap){
    var stopMap = {};

    // Build the mapping between stop names and GTFS stop IDs.
    // When the funciton has been calledo n all of the data, the map is ready to use.
    return function buildStopMap(stopName, avlStopId) {
      stopMap[avlStopId.toLocaleLowerCase()] =
        gtfsStopNameMap[stopName.toLocaleLowerCase()];
      return stopMap;
    };
  };

  return self;
}());
