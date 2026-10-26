/**
 * Statistics for route layers (imported tracks, saved routes and route sections),
 * computed from geometry, as BRouter route statistics are only available for whole routes.
 */
BR.RouteLayerStats = {
    // elevation hysteresis in meters for filtered ascend/descend, similar to BRouter's `filtered ascend`
    ELEVATION_HYSTERESIS: 10,

    /**
     * @param {Array<Array<Array<number>>>} lines list of lines with points as [lat, lng, alt?]
     * @param {Array<Array<number>>} [times] per point times in seconds, one array per line
     *
     * @returns {Object} stats
     */
    calc(lines, times) {
        const hysteresis = BR.RouteLayerStats.ELEVATION_HYSTERESIS;
        const stats = {
            trackLength: 0,
            filteredAscend: 0,
            filteredDescend: 0,
            plainAscend: 0,
            plainDescend: 0,
            minElevation: null,
            maxElevation: null,
            totalTime: null,
            pointCount: 0,
        };

        for (let li = 0; li < lines.length; li++) {
            const line = lines[li];
            // descents fill the ascend buffer, ascents the descend buffer
            let ascendBuffer = 0;
            let descendBuffer = 0;
            let prevAlt = null;

            for (let i = 0; i < line.length; i++) {
                const [lat, lng, alt] = line[i];
                stats.pointCount++;

                if (i > 0) {
                    const [prevLat, prevLng] = line[i - 1];
                    stats.trackLength += BR.RouteLayerStats.distance(prevLat, prevLng, lat, lng);
                }

                if (alt === undefined || alt === null || isNaN(alt)) continue;

                if (stats.minElevation === null || alt < stats.minElevation) stats.minElevation = alt;
                if (stats.maxElevation === null || alt > stats.maxElevation) stats.maxElevation = alt;

                if (prevAlt !== null) {
                    const delta = alt - prevAlt;
                    if (delta > 0) {
                        stats.plainAscend += delta;
                    } else {
                        stats.plainDescend -= delta;
                    }

                    ascendBuffer -= delta;
                    if (ascendBuffer > hysteresis) {
                        ascendBuffer = hysteresis;
                    } else if (ascendBuffer < 0) {
                        stats.filteredAscend -= ascendBuffer;
                        ascendBuffer = 0;
                    }

                    descendBuffer += delta;
                    if (descendBuffer > hysteresis) {
                        descendBuffer = hysteresis;
                    } else if (descendBuffer < 0) {
                        stats.filteredDescend -= descendBuffer;
                        descendBuffer = 0;
                    }
                }
                prevAlt = alt;
            }

            const lineTimes = times && times[li];
            if (lineTimes && lineTimes.length > 1) {
                const duration = lineTimes[lineTimes.length - 1] - lineTimes[0];
                if (!isNaN(duration)) {
                    stats.totalTime = (stats.totalTime || 0) + duration;
                }
            }
        }

        stats.trackLength = Math.round(stats.trackLength);
        stats.filteredAscend = Math.round(stats.filteredAscend);
        stats.filteredDescend = Math.round(stats.filteredDescend);
        stats.plainAscend = Math.round(stats.plainAscend);
        stats.plainDescend = Math.round(stats.plainDescend);

        return stats;
    },

    /**
     * Distance in meters, using the same CheapRuler as BRouter (but without integer rounding per edge)
     */
    distance(lat1, lng1, lat2, lng2) {
        const [ilon1, ilat1] = btools.util.CheapRuler.toIntegerLngLat([lng1, lat1]);
        const [ilon2, ilat2] = btools.util.CheapRuler.toIntegerLngLat([lng2, lat2]);
        return btools.util.CheapRuler.distance(ilon1, ilat1, ilon2, ilat2);
    },

    /**
     * Sums BRouter statistics of route segments (see BR.TrackStats.calcStats)
     */
    fromSegments(segments) {
        const stats = {
            trackLength: 0,
            filteredAscend: 0,
            plainAscend: 0,
            totalTime: 0,
            totalEnergy: 0,
            cost: 0,
        };
        for (const segment of segments) {
            const props = segment.feature.properties;
            stats.trackLength += +props['track-length'];
            stats.filteredAscend += +props['filtered ascend'];
            stats.plainAscend += +props['plain-ascend'];
            stats.totalTime += +props['total-time'];
            stats.totalEnergy += +props['total-energy'];
            stats.cost += +props['cost'];
        }
        return stats;
    },
};
