var currentSeed = 10;
function setSeed(seed) { currentSeed = seed; }
function seededRandom() { currentSeed = (currentSeed * 9301 + 49297) % 233280; return currentSeed / 233280; }

var isDataNormalized = false; 

class LcgRandom {
    constructor(seed) {
        seed = seed || 10;
        this.MULT = BigInt("25214903917");
        this.MASK = (BigInt(1) << BigInt(48)) - BigInt(1);
        this.ADD = BigInt(11);
        this._seed = (BigInt(Math.floor(seed)) ^ this.MULT) & this.MASK;
    }
    _next(bits) {
        this._seed = (this._seed * this.MULT + this.ADD) & this.MASK;
        return Number(this._seed >> BigInt(48 - bits));
    }
    nextInt(bound) {
        bound = Math.floor(bound);
        if (bound <= 0) return 0;
        const b = BigInt(bound);
        if ((b & -b) === b) { 
            return Number((b * BigInt(this._next(31))) >> BigInt(31)); 
        }
        let bits, val;
        do {
            bits = this._next(31);
            val  = bits % bound;
        } while (bits - val + (bound - 1) < 0);
        return val;
    }
}

function showAppMessage(title, text, type = 'info') {
    $('#app-custom-modal').remove();
    const icon = type === 'error' ? '⚠️' : 'ℹ️';
    const color = type === 'error' ? '#ef4444' : '#3b82f6';
    
    const modalHtml = `
        <div id="app-custom-modal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.6); display:flex; align-items:center; justify-content:center; z-index:9999; backdrop-filter:blur(4px);">
            <div style="background:#ffffff; width:90%; max-width:480px; padding:30px; border-radius:12px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04); border-top: 4px solid ${color};">
                <div style="display:flex; gap:16px; align-items:flex-start;">
                    <span style="font-size:32px;">${icon}</span>
                    <div style="flex:1;">
                        <h3 style="margin:0 0 8px 0; font-size:18px; font-weight:700; color:#1e293b;">${title}</h3>
                        <p style="margin:0; font-size:14px; color:#64748b; line-height:1.6;">${text}</p>
                    </div>
                </div>
                <div style="margin-top:24px; display:flex; justify-content:flex-end;">
                    <button id="btn-close-app-modal" style="background:#4f46e5; color:#ffffff; border:none; padding:10px 24px; border-radius:6px; font-size:14px; font-weight:600; cursor:pointer; transition:all 0.2s; box-shadow: 0 4px 6px -1px rgba(79,70,229,0.2);">Đóng</button>
                </div>
            </div>
        </div>
    `;
    $('body').append(modalHtml);
    $('#btn-close-app-modal').on('click', function() {
        $('#app-custom-modal').fadeOut(150, function() { $(this).remove(); });
    });
}

var nominalDomains = {};

function getIqrPercentile(sorted, fraction) {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];
    const idx = fraction * (sorted.length - 1);
    const l = Math.floor(idx);
    const h = idx - l;
    if (l >= sorted.length - 1) return sorted[sorted.length - 1];
    return sorted[l] + h * (sorted[l + 1] - sorted[l]);
}

function getIqrThresholds(data, key) {
    const values = data.map(d => d[key]).filter(v => typeof v === 'number' && !isNaN(v));
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = getIqrPercentile(sorted, 0.25);
    const q3 = getIqrPercentile(sorted, 0.75);
    const iqr = q3 - q1;
    const OF = 1.5;  
    return { upperOutlier: q3 + OF * iqr, lowerOutlier: q1 - OF * iqr };
}

function getOutlierData(data, numKeys) {
    const outlierIndices = new Set();
    let totalOutlierValues = 0;
    if (!data || data.length === 0) return { count: 0, indices: outlierIndices };

    const thresholds = {};
    const cleanNumKeys = numKeys.filter(k => k !== 'species_id' && k !== 'id');
    cleanNumKeys.forEach(k => { thresholds[k] = getIqrThresholds(data, k); });

    data.forEach((row, idx) => {
        let isRowOutlier = false;
        for (const k of cleanNumKeys) {
            const t = thresholds[k];
            if (!t) continue;
            const value = row[k];
            if (typeof value === 'number' && !isNaN(value)) {
                if (value > t.upperOutlier || value < t.lowerOutlier) {
                    totalOutlierValues++; 
                    isRowOutlier = true;  
                }
            }
        }
        if (isRowOutlier) outlierIndices.add(idx);
    });
    return { count: totalOutlierValues, indices: outlierIndices };
}

function buildDomains(data, keys) {
    nominalDomains = {};
    if (!data || data.length === 0) return;
    keys.forEach(k => {
        if (typeof data[0][k] === 'string') {
            const uniqueVals = [];
            data.forEach(row => {
                if (row[k] !== undefined && row[k] !== '' && uniqueVals.indexOf(row[k]) === -1) {
                    uniqueVals.push(row[k]);
                }
            });
            nominalDomains[k] = uniqueVals; 
        }
    });
}

function getNormalizationParams(data, keys) {
    const params = {};
    keys.forEach(k => {
        const vals = data.map(d => d[k]).filter(v => typeof v === 'number' && !isNaN(v));
        if (vals.length === 0) return;
        const min = Math.min.apply(null, vals); const max = Math.max.apply(null, vals);
        params[k] = { min: min, max: max, range: (max - min) || 1 };
    });
    return params;
}

function getZScoreParams(data, keys) {
    const params = {};
    keys.forEach(k => {
        const vals = data.map(d => d[k]).filter(v => typeof v === 'number' && !isNaN(v));
        if (vals.length === 0) return;
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const std = Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length) || 1;
        params[k] = { mean: mean, std: std };
    });
    return params;
}

function getRobustParams(data, keys) {
    const params = {};
    keys.forEach(k => {
        const vals = data.map(d => d[k]).filter(v => typeof v === 'number' && !isNaN(v));
        if (vals.length === 0) return;
        const sorted = [...vals].sort((a, b) => a - b);
        const median = getIqrPercentile(sorted, 0.5);
        const q1 = getIqrPercentile(sorted, 0.25);
        const q3 = getIqrPercentile(sorted, 0.75);
        const iqr = (q3 - q1) || 1; 
        params[k] = { median: median, iqr: iqr };
    });
    return params;
}

function normalizeData(data, params) {
    return data.map(row => {
        const newRow = { ...row };
        Object.keys(params).forEach(k => {
            if (typeof newRow[k] === 'number') newRow[k] = (newRow[k] - params[k].min) / params[k].range;
        });
        if (row._originalId !== undefined) newRow._originalId = row._originalId;
        return newRow;
    });
}

function wekaDistance(a, b) {
    const metric = $('#distanceMetric').val() || 'EUCLIDEAN';
    let sum = 0;
    let maxDiff = -Infinity;
    const pVal = 3; 
    
    Object.keys(a).forEach(key => {
        if (key === '_originalId' || key === '_cluster' || key === 'name' || key === 'id' || key === 'species_id') return;
        if (typeof a[key] === 'number' && typeof b[key] === 'number') {
            const diff = Math.abs(a[key] - b[key]);
            if (metric === 'EUCLIDEAN') {
                sum += diff * diff;
            } else if (metric === 'MANHATTAN') {
                sum += diff;
            } else if (metric === 'CHEBYSHEV') {
                if (diff > maxDiff) maxDiff = diff;
            } else if (metric === 'MINKOWSKI') {
                sum += Math.pow(diff, pVal);
            }
        } else {
            const mismatch = (a[key] === b[key]) ? 0 : 1;
            if (metric === 'EUCLIDEAN') {
                sum += mismatch * mismatch;
            } else if (metric === 'MANHATTAN') {
                sum += mismatch;
            } else if (metric === 'CHEBYSHEV') {
                if (mismatch > maxDiff) maxDiff = mismatch;
            } else if (metric === 'MINKOWSKI') {
                sum += Math.pow(mismatch, pVal);
            }
        }
    });
    
    if (metric === 'EUCLIDEAN') {
        return Math.sqrt(sum);
    } else if (metric === 'MANHATTAN') {
        return sum;
    } else if (metric === 'CHEBYSHEV') {
        return maxDiff === -Infinity ? 0 : maxDiff;
    } else if (metric === 'MINKOWSKI') {
        return Math.pow(sum, 1 / pVal);
    }
    return Math.sqrt(sum);
}

class KMeans {
    constructor(k, data) {
        this.k = k; this.data = data; this.centroids = []; this.clusters = [];
        this.squaredError = 0; this.assignments = new Array(data.length).fill(-1); 
        this.attributes = Object.keys(data[0]).filter(k => k !== '_originalId' && k !== '_cluster' && k !== 'name' && k !== 'species_id' && k !== 'id');
        this.isNumeric = {};
        this.attributes.forEach(attr => { this.isNumeric[attr] = typeof data[0][attr] === 'number'; });
    }
    distance(a, b) { return wekaDistance(a, b); }
    
    initCentroids() {
        const arr = [...this.data]; this.centroids = []; const seen = new Set();
        const jRand = new LcgRandom(currentSeed);
        for (let j = arr.length - 1; j >= 0; j--) {
            const instIndex = jRand.nextInt(j + 1);
            const candidate = arr[instIndex];
            const candidateForHash = {}; this.attributes.forEach(attr => { candidateForHash[attr] = candidate[attr]; });
            const hash = JSON.stringify(candidateForHash);
            if (!seen.has(hash)) { this.centroids.push({ ...candidate }); seen.add(hash); }
            const temp = arr[j]; arr[j] = arr[instIndex]; arr[instIndex] = temp;
            if (this.centroids.length === this.k) break;
        }
        this.k = this.centroids.length;
    }
    
    assignClusters() {
        let converged = true; const newClusters = Array.from({ length: this.k }, () => []); this.squaredError = 0;
        this.data.forEach((point, i) => {
            let minDist = Infinity; let bestCluster = 0;
            this.centroids.forEach((c, cIdx) => { const d = this.distance(point, c); if (d < minDist) { minDist = d; bestCluster = cIdx; } });
            if (this.assignments[i] !== bestCluster) converged = false;
            this.assignments[i] = bestCluster; this.squaredError += minDist * minDist;
            newClusters[bestCluster].push(point);
        });
        this.clusters = newClusters; return converged;
    }
    
    updateCentroids() {
        let emptyClusters = []; const newCentroids = [];
        this.clusters.forEach((cluster, i) => {
            if (cluster.length === 0) { emptyClusters.push(i); return; }
            const centroid = {};
            this.attributes.forEach(attr => {
                if (this.isNumeric[attr]) { 
                    let sum = 0; cluster.forEach(p => { sum += (p[attr] || 0); }); 
                    centroid[attr] = sum / cluster.length; 
                } else {
                    const counts = {}; cluster.forEach(p => { const val = p[attr]; counts[val] = (counts[val] || 0) + 1; });
                    let bestVal = null; let maxCount = -1;
                    (nominalDomains[attr] || Object.keys(counts)).forEach(val => {
                        if ((counts[val] || 0) > maxCount) { maxCount = counts[val] || 0; bestVal = val; }
                    });
                    centroid[attr] = bestVal;
                }
            });
            newCentroids.push(centroid);
        });
        this.centroids = newCentroids;
        this.clusters = this.clusters.filter((_, i) => emptyClusters.indexOf(i) === -1);
        this.k = this.centroids.length;
    }
    
    run(maxIter = 500) { 
        this.initCentroids();
        let iterations = 0;
        for (let i = 0; i < maxIter; i++) { iterations++; const converged = this.assignClusters(); this.updateCentroids(); if (converged) break; }
        this.assignClusters(); 
        const finalClusters = this.clusters.filter(c => c.length > 0);
        finalClusters.model = { squaredError: this.squaredError, iterations: iterations }; 
        return finalClusters;
    }
}

class HierarchicalClustering {
    constructor(k, data, linkage = 'SINGLE') { 
        this.data = data; this.linkage = linkage.toUpperCase(); this.tree = null;
    }
    distance(a, b) { return wekaDistance(a, b); }
    clusterDistance(c1, c2) {
        if (this.linkage === 'SINGLE') { 
            let minD = Infinity; c1.points.forEach(p1 => c2.points.forEach(p2 => { let d = this.distance(p1, p2); if (d < minD) minD = d; })); return minD; 
        } else if (this.linkage === 'COMPLETE') { 
            let maxD = -Infinity; c1.points.forEach(p1 => c2.points.forEach(p2 => { let d = this.distance(p1, p2); if (d > maxD) maxD = d; })); return maxD; 
        } else { 
            let sum = 0; c1.points.forEach(p1 => c2.points.forEach(p2 => { sum += this.distance(p1, p2); })); return sum / (c1.points.length * c2.points.length);
        }
    }
    run() {
        let fullTreeNodes = this.data.map((p, i) => ({ id: i, points: [p], children: null, height: 0, name: p.name || `Item ${i}` }));
        let clusterCounter = this.data.length;
        while (fullTreeNodes.length > 1) {
            let minDist = Infinity, mergeIdx1 = -1, mergeIdx2 = -1;
            for (let i = 0; i < fullTreeNodes.length; i++) {
                for (let j = i + 1; j < fullTreeNodes.length; j++) { 
                    const d = this.clusterDistance(fullTreeNodes[i], fullTreeNodes[j]); 
                    if (d < minDist) { minDist = d; mergeIdx1 = i; mergeIdx2 = j; } 
                }
            }
            if (mergeIdx1 === -1) break;
            const newNode = {
                id: clusterCounter++,
                points: [...fullTreeNodes[mergeIdx1].points, ...fullTreeNodes[mergeIdx2].points],
                children: [fullTreeNodes[mergeIdx1], fullTreeNodes[mergeIdx2]],
                height: minDist, name: `Merge_${clusterCounter}`
            };
            fullTreeNodes.splice(mergeIdx2, 1); fullTreeNodes.splice(mergeIdx1, 1); fullTreeNodes.push(newNode);
        }
        this.tree = fullTreeNodes[0]; return this.tree;
    }
}

class CLARA {
    constructor(k, data, numSamples = 5, sampleSize = 40 + 2 * k) { 
        this.k = k; this.data = data; this.numSamples = numSamples; 
        this.sampleSize = Math.min(sampleSize, data.length); 
        this.centroids = []; 
    }
    distance(a, b) { return wekaDistance(a, b); }
    calculateCost(dataset, medoids) { let cost = 0; dataset.forEach(point => { let minDist = Infinity; medoids.forEach(m => { const d = this.distance(point, m); if (d < minDist) minDist = d; }); cost += minDist; }); return cost; }
    run() {
        let bestMedoids = []; let minTotalCost = Infinity; const jRand = new LcgRandom(currentSeed);
        for (let s = 0; s < this.numSamples; s++) {
            let tempArr = [...this.data];
            for (let i = tempArr.length - 1; i > 0; i--) { const j = jRand.nextInt(i + 1); const temp = tempArr[i]; tempArr[i] = tempArr[j]; tempArr[j] = temp; }
            const sample = tempArr.slice(0, this.sampleSize);
            let medoids = sample.slice(0, this.k); let bestSampleMedoids = [...medoids]; let minSampleCost = this.calculateCost(sample, medoids);
            let improved = true;
            while (improved) {
                improved = false;
                for (let i = 0; i < this.k; i++) {
                    for (let j = 0; j < sample.length; j++) {
                        let isMedoid = false;
                        for(let m=0; m<medoids.length; m++) { if (medoids[m]._originalId === sample[j]._originalId) isMedoid = true; }
                        if (isMedoid) continue;
                        const newMedoids = [...medoids]; newMedoids[i] = sample[j];
                        const cost = this.calculateCost(sample, newMedoids);
                        if (cost < minSampleCost) { minSampleCost = cost; bestSampleMedoids = [...newMedoids]; improved = true; }
                    }
                }
                medoids = [...bestSampleMedoids];
            }
            const entireCost = this.calculateCost(this.data, medoids);
            if (entireCost < minTotalCost) { minTotalCost = entireCost; bestMedoids = [...medoids]; }
        }
        this.centroids = bestMedoids; 
        const clusters = Array.from({ length: this.k }, () => []);
        this.data.forEach(point => { let minDist = Infinity, bestIdx = 0; this.centroids.forEach((m, idx) => { const d = this.distance(point, m); if (d < minDist) { minDist = d; bestIdx = idx; } }); clusters[bestIdx].push(point); });
        const finalClusters = clusters.filter(c => c.length > 0); finalClusters.model = this; return finalClusters;
    }
}

class GaussianMixture {
    constructor(k, data, covType = 'diag') {
        this.k = k; this.data = data; this.covType = covType; this.n = data.length; this.keys = Object.keys(data[0]).filter(k => k !== '_originalId');
        this.isNumeric = {}; this.nominalCounts = {}; 
        this.keys.forEach(k => { this.isNumeric[k] = (typeof data[0][k] === 'number'); if (!this.isNumeric[k]) { const s = new Set(); data.forEach(d => s.add(d[k])); this.nominalCounts[k] = s.size; } });
        this.keys = this.keys.filter(k => k !== 'name' && k !== 'species_id' && k !== 'id');
        this.priors = new Array(k).fill(0); this.modelNormal = Array.from({length: k}, () => ({})); this.modelNominal = Array.from({length: k}, () => ({})); this.weights = Array.from({length: this.n}, () => new Array(k).fill(0)); this.minStdDev = 1e-6; 
    }
    _vec(point) { return this.keys.map(k => point[k] || 0); }
    _estimateParameters() {
        let totalPrior = 0;
        for (let c = 0; c < this.k; c++) { let sumWeights = 0; for (let i = 0; i < this.n; i++) sumWeights += this.weights[i][c]; this.priors[c] = sumWeights + 1.0; totalPrior += this.priors[c]; }
        for (let c = 0; c < this.k; c++) this.priors[c] /= totalPrior;
        for (let c = 0; c < this.k; c++) {
            let sumWeights = 0; for (let i = 0; i < this.n; i++) sumWeights += this.weights[i][c];
            this.keys.forEach(key => {
                if (this.isNumeric[key]) {
                    if (sumWeights <= 0) { this.modelNormal[c][key] = { mean: 0, variance: Number.MAX_VALUE }; } 
                    else {
                        let mean = 0; for (let i = 0; i < this.n; i++) mean += this.weights[i][c] * (this.data[i][key] || 0); mean /= sumWeights;
                        let variance = 0; for (let i = 0; i < this.n; i++) { const diff = (this.data[i][key] || 0) - mean; variance += this.weights[i][c] * diff * diff; }
                        variance /= sumWeights; if (variance < this.minStdDev) variance = this.minStdDev; this.modelNormal[c][key] = { mean, variance };
                    }
                } else {
                    const counts = {}; for (let i = 0; i < this.n; i++) { const val = this.data[i][key]; counts[val] = (counts[val] || 0) + this.weights[i][c]; }
                    const numCat = this.nominalCounts[key]; this.modelNominal[c][key] = {};
                    for (let val in counts) { this.modelNominal[c][key][val] = (counts[val] + 1.0) / (sumWeights + numCat); }
                    this.modelNominal[c][key]['_default'] = 1.0 / (sumWeights + numCat);
                }
            });
        }
    }
    _eStep() {
        let logLikelihood = 0;
        for (let i = 0; i < this.n; i++) {
            const logProbs = new Array(this.k).fill(0);
            for (let c = 0; c < this.k; c++) {
                let logProb = Math.log(this.priors[c]);
                this.keys.forEach(key => {
                    const val = this.data[i][key];
                    if (this.isNumeric[key]) { const mean = this.modelNormal[c][key].mean; const variance = this.modelNormal[c][key].variance; logProb += -0.5 * Math.log(2 * Math.PI * variance) - 0.5 * Math.pow((val || 0) - mean, 2) / variance; } 
                    else { const prob = this.modelNominal[c][key][val] || this.modelNominal[c][key]['_default']; logProb += Math.log(prob); }
                });
                logProbs[c] = logProb;
            }
            const maxLog = Math.max.apply(null, logProbs); let sumExp = 0; for (let c = 0; c < this.k; c++) sumExp += Math.exp(logProbs[c] - maxLog);
            logLikelihood += maxLog + Math.log(sumExp); for (let c = 0; c < this.k; c++) this.weights[i][c] = Math.exp(logProbs[c] - maxLog) / sumExp;
        }
        return logLikelihood;
    }
    
    assignPoint(point) {
        const logProbs = new Array(this.k).fill(0);
        for (let c = 0; c < this.k; c++) {
            let logProb = Math.log(this.priors[c]);
            this.keys.forEach(key => {
                const val = point[key];
                if (this.isNumeric[key]) {
                    const mean = this.modelNormal[c][key].mean;
                    const variance = this.modelNormal[c][key].variance;
                    logProb += -0.5 * Math.log(2 * Math.PI * variance) - 0.5 * Math.pow((val || 0) - mean, 2) / variance;
                } else {
                    const prob = this.modelNominal[c][key][val] || this.modelNominal[c][key]['_default'];
                    logProb += Math.log(prob);
                }
            });
            logProbs[c] = logProb;
        }
        return logProbs.indexOf(Math.max.apply(null, logProbs));
    }

    run(maxIter = 100) { 
        const km = new KMeans(this.k, this.data); km.run(100); 
        for(let i=0; i<this.n; i++) { let assigned = km.assignments[i]; if (assigned < 0) assigned = 0; this.weights[i][assigned] = 1.0; }
        this._estimateParameters(); let prevLL = -Infinity;
        for (let iter = 0; iter < maxIter; iter++) { const currentLL = this._eStep(); this._estimateParameters(); if (Math.abs(currentLL - prevLL) < 1e-6) break; prevLL = currentLL; }
        const clusters = Array.from({ length: this.k }, () => []);
        for (let i = 0; i < this.n; i++) { const w = this.weights[i]; const bestK = w.indexOf(Math.max.apply(null, w)); clusters[bestK].push(this.data[i]); }
        const finalClusters = clusters.filter(c => c.length > 0); finalClusters.model = this; return finalClusters;
    }
}

function calculateSSE(clusters, evalKeys) {
    let totalSSE = 0; if (!Array.isArray(clusters)) return 0;
    clusters.forEach(cluster => {
        if (!Array.isArray(cluster) || cluster.length === 0) return;
        const centroid = {};
        evalKeys.forEach(key => { centroid[key] = cluster.reduce((sum, p) => sum + (Number(p[key]) || 0), 0) / cluster.length; });
        cluster.forEach(point => { const dist = wekaDistance(point, centroid); totalSSE += dist * dist; });
    });
    return totalSSE;
}

function assignTestData(modelInstance, testData, algo) {
    const testClusters = Array.from({ length: modelInstance.k || modelInstance.centroids.length }, () => []);
    testData.forEach(point => {
        let bestClusterIdx = 0;
        if (algo === 'kmeans' || algo === 'clara') {
            let minDist = Infinity;
            modelInstance.centroids.forEach((c, cIdx) => {
                const d = wekaDistance(point, c);
                if (d < minDist) { minDist = d; bestClusterIdx = cIdx; }
            });
        } else if (algo === 'gmm') {
            bestClusterIdx = modelInstance.assignPoint(point);
        }
        testClusters[bestClusterIdx].push(point);
    });
    return testClusters;
}

var COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#6366f1', '#ef4444', '#14b8a6', '#f43f5e', '#84cc16', '#06b6d4', '#d946ef'];
var parsedData = []; var numericFeatures = []; var displayResults = [];

function parseCSV(text) {
    const lines = text.trim().split('\n'); const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
        const values = line.split(','); const obj = {};
        headers.forEach((h, i) => { const val = parseFloat(values[i]); obj[h] = isNaN(val) ? (values[i] || '').trim() : val; });
        return obj;
    }).filter(row => Object.keys(row).length === headers.length);
}

function drawClassDistribution(canvas, data, allKeys, numKeys) {
    if (!canvas || data.length === 0) return;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
    const targetKey = allKeys[allKeys.length - 1]; const isNumeric = numKeys.indexOf(targetKey) !== -1;
    let labels = [], counts = [];
    if (isNumeric) {
        const vals = data.map(d => d[targetKey]); const min = Math.min.apply(null, vals); const max = Math.max.apply(null, vals);
        const binCount = 6; const binSize = (max - min) / binCount || 1; counts = new Array(binCount).fill(0);
        vals.forEach(v => { let idx = Math.floor((v - min) / binSize); if (idx >= binCount) idx = binCount - 1; counts[idx]++; });
        for (let i = 0; i < binCount; i++) labels.push(`${(min + i * binSize).toFixed(1)}-${(min + (i + 1) * binSize).toFixed(1)}`);
    } else {
        const freqs = {}; data.forEach(d => { const val = d[targetKey] || 'Unknown'; freqs[val] = (freqs[val] || 0) + 1; });
        const sorted = Object.keys(freqs).map(k => [k, freqs[k]]).sort((a, b) => b[1] - a[1]);
        labels = sorted.slice(0, 12).map(x => x[0]); counts = sorted.slice(0, 12).map(x => x[1]);
    }
    const maxCount = Math.max.apply(null, counts) || 1; const w = canvas.width; const h = canvas.height;
    const paddingBottom = 45; const paddingTop = 20; const chartH = h - paddingBottom - paddingTop;
    const spacing = w / counts.length; const barW = spacing * 0.6; const totalInstances = data.length;
    counts.forEach((count, i) => {
        const barH = (count / maxCount) * chartH; const x = i * spacing + (spacing - barW) / 2; const y = h - paddingBottom - barH;
        ctx.fillStyle = COLORS[i % COLORS.length]; ctx.beginPath(); 
        if(ctx.roundRect) { ctx.roundRect(x, y, barW, barH, [6, 6, 0, 0]); } else { ctx.rect(x, y, barW, barH); }
        ctx.fill();
        ctx.textAlign = 'center'; ctx.fillStyle = '#475569'; ctx.font = 'bold 11px sans-serif';
        ctx.fillText((labels[i].length > 10 ? labels[i].substring(0, 8) + '...' : labels[i]).toUpperCase(), x + barW / 2, h - 28);
        if (!isNumeric) {
            ctx.fillStyle = '#64748b'; ctx.font = '11px sans-serif'; ctx.fillText(count, x + barW / 2, h - 14);
            ctx.fillStyle = '#94a3b8'; ctx.fillText(((count / totalInstances) * 100).toFixed(1) + '%', x + barW / 2, h - 2);
        }
    });
}

function drawMiniHistogram(canvas, vals, min, max) {
    if (!canvas) return; const ctx = canvas.getContext('2d'); const bins = new Array(10).fill(0);
    vals.forEach(v => { let idx = Math.floor((v - min) / (max - min || 1) * 10); if (idx === 10) idx = 9; bins[idx]++; });
    const maxFreq = Math.max.apply(null, bins) || 1; const w = canvas.width; const h = canvas.height; const barW = w / 10;
    ctx.fillStyle = '#5b5de5';
    bins.forEach((freq, i) => { const barH = (freq / maxFreq) * h * 0.9; ctx.beginPath(); if(ctx.roundRect) { ctx.roundRect(i * barW + 2, h - barH, barW - 4, barH, [4, 4, 0, 0]); } else { ctx.rect(i * barW + 2, h - barH, barW - 4, barH); } ctx.fill(); });
}

function drawDendrogram(canvas, rootNode) {
    const dpr = window.devicePixelRatio || 1; const rectW = canvas.clientWidth || 800;
    function totalLeaves(node) { if (!node.children) return 1; return totalLeaves(node.children[0]) + totalLeaves(node.children[1]); }
    const totalL = totalLeaves(rootNode);
    const leafSpacing = 42; const padding = 35; const rectH = Math.max(500, totalL * leafSpacing + padding * 2); 
    
    canvas.style.height = rectH + 'px'; canvas.width = rectW * dpr; canvas.height = rectH * dpr;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, rectW, rectH);
    
    const margin = 190; const drawWidth = rectW - margin - 35; const drawHeight = rectH - padding * 2;
    let leafCount = 0;
    function assignLayout(node) {
        if (!node.children) { node.y = padding + (leafCount++) * (drawHeight / Math.max(1, totalL - 1)); return; }
        assignLayout(node.children[0]); assignLayout(node.children[1]);
        node.y = (node.children[0].y + node.children[1].y) / 2;
    }
    assignLayout(rootNode);
    const maxH = rootNode.height || 1;

    function render(node, x, y) {
        if (!node.children) {
            ctx.fillStyle = '#1e293b'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.font = '600 13px Helvetica, Arial, sans-serif'; 
            const originalRow = parsedData.find(x => x._originalId === node.points[0]._originalId);
            const label = (originalRow && originalRow.name) ? originalRow.name : `Item ${node.id}`;
            ctx.fillText(label, margin - 15, y); 
            ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(margin - 8, y); ctx.stroke();
            return;
        }
        const xChild = (node.height / maxH) * drawWidth + margin; const yLeft = node.children[0].y; const yRight = node.children[1].y;
        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(xChild, y); ctx.moveTo(xChild, yLeft); ctx.lineTo(xChild, yRight); ctx.stroke();
        render(node.children[0], xChild, yLeft); render(node.children[1], xChild, yRight);
    }
    render(rootNode, drawWidth + margin, rootNode.y);
}

function processLoadedData(data) {
    parsedData = data.map(row => {
        const cleanRow = {};
        Object.keys(row).forEach(key => {
            const val = parseFloat(row[key]);
            cleanRow[key] = isNaN(val) ? (row[key] !== undefined ? String(row[key]).trim() : '') : val;
        });
        return cleanRow;
    });

    if (parsedData.length === 0) return;
    let duplicateCount = 0; const seenRows = new Set();
    parsedData.forEach((row, i) => {
        row._originalId = i;
        const rowForCompare = { ...row }; delete rowForCompare._originalId;
        const rowString = JSON.stringify(rowForCompare);
        if (seenRows.has(rowString)) { duplicateCount++; } else { seenRows.add(rowString); }
    });
    
    isDataNormalized = false;

    const allKeys = Object.keys(parsedData[0]).filter(k => k !== '_originalId');
    const numKeys = allKeys.filter((k, idx) => {
        const isNumType = typeof parsedData[0][k] === 'number';
        const isLastClassCol = (idx === allKeys.length - 1);
        return isNumType && !isLastClassCol; 
    });
    const outlierData = getOutlierData(parsedData, numKeys);

    renderDataLoader(parsedData); 
    $('#st-duplicates').text(duplicateCount.toLocaleString()); $('#st-outliers').text(outlierData.count.toLocaleString());
    $('#empty-dataloader-wrapper').hide(); $('#dataloader-content').fadeIn(); $('#empty-results').css('display', 'flex'); $('#resultSection').hide();
    const $alertContainer = $('#alert-container').empty(); const totalRows = parsedData.length;
    
    if (outlierData.count > 0) { 
        $alertContainer.append(`<div class="custom-alert alert-danger"><div class="alert-icon">⚠️</div><div class="alert-content"><div class="alert-title">Outliers detected: ${outlierData.count.toLocaleString()} outlier values identified</div><div class="alert-desc">Recommendation: Use "Winsorize Outliers" to preserve your dataset or "Remove Outliers" to delete them. Additionally, consider using the robust "Robust Scale" normalization.</div></div><button class="btn-alert-action btn-open-preprocess">Open Preprocessing</button></div>`); 
    }
    if (duplicateCount > 0) { 
        const dupPercent = ((duplicateCount / totalRows) * 100).toFixed(1); 
        $alertContainer.append(`<div class="custom-alert alert-warning"><div class="alert-icon">⚠️</div><div class="alert-content"><div class="alert-title">Duplicate data detected: ${duplicateCount.toLocaleString()} rows (${dupPercent}%) are duplicates</div><div class="alert-desc">Recommendation: Use "Remove Duplicates" or related filters in preprocessing</div></div><button class="btn-alert-action btn-open-preprocess">Open Preprocessing</button></div>`); 
    }
}

function renderDataLoader(data) {
    if (!data || data.length === 0) return;
    const keys = Object.keys(data[0]).filter(k => k !== '_originalId');
    numericFeatures = keys.filter(k => typeof data[0][k] === 'number');
    $('#st-rows').text(data.length.toLocaleString()); $('#st-cols').text(keys.length);
    $('#st-num').text(numericFeatures.length); $('#st-cat').text(keys.length - numericFeatures.length);
    $('#stats-num-count').text(numericFeatures.length);
    const $statsList = $('#stats-summary-list').empty();
    
    numericFeatures.forEach(key => {
        const vals = data.map(d => d[key]).filter(v => typeof v === 'number' && !isNaN(v));
        const min = Math.min.apply(null, vals).toFixed(2); const max = Math.max.apply(null, vals).toFixed(2);
        const mean = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
        const std = Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length).toFixed(2);
        const thresholds = getIqrThresholds(data, key);
        let outlierCountForAttr = 0;
        if (thresholds) {
            data.forEach(row => {
                const val = row[key];
                if (typeof val === 'number' && !isNaN(val)) { if (val > thresholds.upperOutlier || val < thresholds.lowerOutlier) outlierCountForAttr++; }
            });
        }
        const outlierHtml = thresholds ? `<div style="display:flex;justify-content:space-between;color:#ef4444;font-weight:600;margin-top:8px;font-size:12px;"><span>  Outliers:</span><span>${outlierCountForAttr} values</span></div>` : '';
        $statsList.append(`<div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border);"><div style="font-weight:600;font-size:13px;color:var(--text-dark);margin-bottom:8px;">${key}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:var(--text-muted);"><div style="display:flex;justify-content:space-between;"><span>Min:</span><span style="color:var(--text-dark);font-weight:500;">${min}</span></div><div style="display:flex;justify-content:space-between;"><span>Max:</span><span style="color:var(--text-dark);font-weight:500;">${max}</span></div><div style="display:flex;justify-content:space-between;"><span>Mean:</span><span style="color:var(--text-dark);font-weight:500;">${mean}</span></div><div style="display:flex;justify-content:space-between;"><span>StdDev:</span><span style="color:var(--text-dark);font-weight:500;">${std}</span></div></div>${outlierHtml}</div>`);
    });

    drawClassDistribution(document.getElementById('classDistChart'), data, keys, numericFeatures);
    const $thead = $('#preview-table thead').empty().append('<tr><th>ROW</th></tr>');
    keys.forEach(k => $thead.find('tr').append($('<th>').text(k)));
    const $tbody = $('#preview-table tbody').empty();
    data.slice(0, 10).forEach((row, idx) => { const $tr = $('<tr>').append($('<td>').text(idx + 1)); keys.forEach(k => $tr.append($('<td>').text(row[k]))); $tbody.append($tr); });
    const $visContainer = $('#vis-container').empty();
    numericFeatures.forEach(key => {
        const vals = data.map(d => d[key]); const min = Math.min.apply(null, vals); const max = Math.max.apply(null, vals);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length; const std = Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length);
        $visContainer.append(`<div class="vis-card"><div class="vis-header"><div><div class="vis-title">${key}</div><div class="badge-numeric">Numeric</div></div></div><div class="vis-stats"><div>Mean: ${mean.toFixed(2)}<br>Min: ${min.toFixed(2)}</div><div style="text-align:right;">Std: ${std.toFixed(2)}<br>Max: ${max.toFixed(2)}</div></div><div class="vis-canvas-wrap"><canvas id="hist-${key}" width="200" height="100" style="width:100%;height:100%;"></canvas></div></div>`);
        drawMiniHistogram(document.getElementById(`hist-${key}`), vals, min, max);
    });
    const $list = $('#featuresList').empty();
    keys.forEach(key => { $list.append(`<label style="display:block;margin-bottom:4px;font-size:13px;"><input type="checkbox" value="${key}" checked> ${key}</label>`); });
}

function renderPreprocessTable(data) {
    if (!data || data.length === 0) return;
    const keys = Object.keys(data[0]).filter(k => k !== '_originalId');
    const $thead = $('#preprocess-table thead').empty().append('<tr><th>ROW</th></tr>');
    keys.forEach(k => $thead.find('tr').append($('<th>').text(k)));
    const $tbody = $('#preprocess-table tbody').empty();
    data.forEach((row, idx) => {
        const $tr = $('<tr>').append($('<td>').text(idx + 1));
        keys.forEach(k => {
            let cellValue = row[k];
            $tr.append(`<td>${cellValue !== null && cellValue !== '' ? cellValue : 'NaN'}</td>`);
        });
        $tbody.append($tr);
    });
}

function renderChart(clusters) {
    const canvas = document.getElementById('scatterChart'); 
    const dpr = window.devicePixelRatio || 1;
    const rectW = canvas.clientWidth || 800; 
    const rectH = canvas.clientHeight || 350;
    canvas.width = rectW * dpr; 
    canvas.height = rectH * dpr;
    const ctx = canvas.getContext('2d'); 
    ctx.scale(dpr, dpr); 
    ctx.fillStyle = '#ffffff'; 
    ctx.fillRect(0, 0, rectW, rectH);
    if (!clusters || clusters.length === 0) return;
    
    const k = clusters.length;
    const pad = 100;
    const w = rectW - pad * 2;
    const h = rectH - pad * 2;
    
    clusters.forEach((c, idx) => {
        const centerX = pad + (w / (k > 1 ? k - 1 : 1)) * idx;
        const centerY = rectH / 2;
        
        ctx.fillStyle = COLORS[idx % COLORS.length] + '15';
        ctx.beginPath();
        ctx.arc(centerX, centerY, 65, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = COLORS[idx % COLORS.length] + '40';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.fillStyle = COLORS[idx % COLORS.length];
        ctx.font = 'bold 13px sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(`Cụm ${idx + 1} (${c.length} dòng)`, centerX, centerY - 80);
        
        c.forEach((p, pIdx) => {
            const angle = pIdx * (137.5 * Math.PI / 180);
            const radius = Math.min(50, 10 + Math.sqrt(pIdx) * 14);
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;
            
            ctx.fillStyle = COLORS[idx % COLORS.length];
            ctx.beginPath();
            ctx.arc(x, y, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            
            ctx.fillStyle = '#1e293b';
            ctx.font = '10px sans-serif';
            ctx.fillText(p.name || `Dòng ${p._originalId || pIdx}`, x, y - 11);
        });
    });
}

function renderClusterTables(clusters) {
    const $tabs = $('#clusterTabs').empty(); const $content = $('#clusterContent').empty();
    if (!clusters || clusters.length === 0) return;
    let keys = []; for (let i = 0; i < clusters.length; i++) { if (clusters[i].length > 0) { keys = Object.keys(clusters[i][0]).filter(k => k !== '_originalId'); break; } }
    clusters.forEach((cluster, idx) => {
        const isActive = idx === 0 ? 'active' : ''; const tabColor = COLORS[idx % COLORS.length];
        $tabs.append(`<button class="cluster-tab-btn ${isActive}" data-idx="${idx}" style="border:1px solid ${tabColor};color:${tabColor};background:${isActive ? tabColor + '20' : 'transparent'};padding:6px 16px;border-radius:20px;font-weight:bold;cursor:pointer;transition:all 0.2s;">Nhóm ${idx + 1} (${cluster.length.toLocaleString()})</button>`);
        let tableHtml = `<div class="cluster-table-wrap" id="c-table-${idx}" style="display:${isActive ? 'block' : 'none'};"><table class="clustering-table" style="min-width:800px;"><thead><tr><th>#</th>`;
        keys.forEach(k => tableHtml += `<th>${k}</th>`); tableHtml += `</tr></thead><tbody>`;
        cluster.slice(0, 100).forEach((row, rIdx) => {
            tableHtml += `<tr><td>${rIdx + 1}</td>`;
            keys.forEach(k => { let val = row[k]; if (typeof val === 'number' && !Number.isInteger(val)) val = val.toFixed(4); tableHtml += `<td>${val}</td>`; }); tableHtml += `</tr>`;
        });
        tableHtml += `</tbody></table></div>`; $content.append(tableHtml);
    });
    $('.cluster-tab-btn').on('click', function () {
        $('.cluster-tab-btn').each(function () { $(this).css('background', 'transparent').removeClass('active'); });
        const color = $(this).css('color'); $(this).css('background', color.replace(')', ', 0.12)').replace('rgb', 'rgba')).addClass('active');
        const targetIdx = $(this).data('idx'); $('.cluster-table-wrap').hide(); $(`#c-table-${targetIdx}`).show();
    });
}

$(function () {
    $('#algorithm').on('change', function () {
        const val = $(this).val();
        $('#lbl-algo-header').text($(this).find('option:selected').text());
        $('#kGroup').show(); 
        $('#kValueContainer').hide(); $('#seedContainer').hide(); $('#hcLinkageContainer').hide();
        $('#gmmMaxIterGroup').hide();

        let descText = "";
        if (val === 'kmeans' || val === 'clara') {
            $('#kValueContainer').show(); $('#seedContainer').show();
            if (val === 'kmeans') descText = "K-means clustering algorithm.";
            if (val === 'clara') descText = "Clustering Large Applications (CLARA) algorithm.";
        } else if (val === 'hierarchical') {
            $('#kValueContainer').hide(); $('#hcLinkageContainer').show();
            descText = "Hierarchical clustering algorithm (UPGMA).";
        } else if (val === 'gmm') {
            $('#kValueContainer').show(); $('#gmmMaxIterGroup').show();
            descText = "Simple EM (expectation maximisation) class.";
        } else {
            showAppMessage('Tính năng tinh giản', 'Hệ thống đã được tối ưu hóa chỉ tập trung vào các giải thuật phân hoạch hướng tâm cốt lõi và phân cấp. Tự động chuyển về giải thuật K-Means.', 'info');
            $('#algorithm').val('kmeans').trigger('change');
            return;
        }
        $('#algo-desc').text(descText);
    });

    $(document).on('click', '#btn-toggle-sidebar', function () { $('#clustering-app').toggleClass('sidebar-hidden'); $(this).text($('#clustering-app').hasClass('sidebar-hidden') ? '❯' : '❮'); });
    $(document).on('click', '#btn-toggle-config', function () { $(this).closest('.view-section').find('.ml-layout').toggleClass('config-hidden'); $(this).text($(this).closest('.view-section').find('.ml-layout').hasClass('config-hidden') ? '❯' : '❮'); });

    $('.menu-item, .submenu li').off('click');
    $('.menu-item').on('click', function () {
        const $submenu = $(this).next('.submenu');
        if ($submenu.length > 0) { $(this).toggleClass('expanded'); $submenu.slideToggle(200); return; }
        if ($(this).data('nav')) {
            $('.menu-item, .submenu li').removeClass('active'); $(this).addClass('active');
            const targetView = $(this).data('nav');
            $('.view-section').removeClass('active'); $('#view-' + targetView).addClass('active');
            $('#current-step-title').text($(this).text().replace(/▼|▲/g, '').replace(/[\n\r]+/g, ' ').trim().replace(/^\d+\s*/, ''));
            if (targetView === 'preprocess' && parsedData.length > 0) {
                const keys = Object.keys(parsedData[0]).filter(k => k !== '_originalId');
                const $sel = $('#filter-col-select').empty(); keys.forEach(k => $sel.append(`<option value="${k}">${k}</option>`));
                renderPreprocessTable(parsedData);
            }
        }
    });
    
    $('.submenu li').on('click', function () {
        if ($(this).data('nav')) {
            $('.menu-item, .submenu li').removeClass('active'); $(this).addClass('active'); $(this).parent().prev('.menu-item').addClass('active');
            const targetView = $(this).data('nav');
            $('.view-section').removeClass('active'); $('#view-' + targetView).addClass('active');
            $('#current-step-title').text('ML Task - ' + $(this).text().trim());
            if (targetView === 'clustering') $('#algorithm').val('kmeans').trigger('change');
        }
    });
    
    $('[data-tab]').on('click', function () { $('.clustering-tab').removeClass('active'); $(this).addClass('active'); $('.tab-pane').hide(); $('#' + $(this).data('tab')).show(); });
    $('.ml-config-tab').on('click', function () {
        const $p = $(this).closest('.ml-config-panel');
        $p.find('.ml-config-tab').removeClass('active'); $(this).addClass('active');
        $p.find('.ml-config-content').hide(); $('#' + $(this).data('panel')).fadeIn(200);
    });

    $('.btn-new-session').on('click', function() { location.reload(); });
    $('#btnUploadCenter').on('click', function (e) { e.stopPropagation(); $('#fileInput').trigger('click'); });
    $('#empty-dataloader').on('click', function () { $('#fileInput').trigger('click'); });

    $('#fileInput').on('change', function (e) {
        const file = e.target.files[0]; if (!file) return;
        $('#fileName').text(file.name); $('#fileBadge').css('display', 'flex');
        const reader = new FileReader();
        const extension = file.name.split('.').pop().toLowerCase();

        if (extension === 'xlsx' || extension === 'xls') {
            reader.onload = function (evt) {
                const data = new Uint8Array(evt.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
                processLoadedData(json);
            };
            reader.readAsArrayBuffer(file);
        } else {
            reader.onload = function (evt) {
                const parsed = parseCSV(evt.target.result);
                processLoadedData(parsed);
            };
            reader.readAsText(file, 'UTF-8');
        }
    });
    
    $(document).on('click', '.btn-open-preprocess', function () { $('.menu-item[data-nav="preprocess"]').trigger('click'); });
    $('#filter-type').on('change', function () { $(this).val() === 'drop-col' ? $('#filter-col-group').show() : $('#filter-col-group').hide(); });

    $('#btnApplyFilter').on('click', function () {
        if (!parsedData || parsedData.length === 0) { showAppMessage('Lỗi tiền xử lý', 'Vui lòng nạp tệp dữ liệu CSV trước khi áp dụng bộ lọc!', 'error'); return; }
        const type = $('#filter-type').val(); let newData = [...parsedData];

        if (type === 'remove-missing') {
            newData = parsedData.filter(row => { let ok = true; Object.keys(row).forEach(k => { if (k !== '_originalId' && (row[k] === '' || row[k] === null || (typeof row[k] === 'number' && isNaN(row[k])))) ok = false; }); return ok; });
            const r = parsedData.length - newData.length; $('#preprocess-status').text(r === 0 ? '✨ Dữ liệu sạch!' : `✅ Đã xóa ${r} dòng thiếu dữ liệu.`);
        } else if (type === 'replace-mean') {
            newData = JSON.parse(JSON.stringify(parsedData));
            const nk = Object.keys(newData[0]).filter(k => typeof newData[0][k] === 'number' && k !== '_originalId'); let replaced = 0;
            nk.forEach(k => { const vals = parsedData.map(r => r[k]).filter(v => typeof v === 'number' && !isNaN(v)); const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0; newData.forEach(row => { if (row[k] === '' || row[k] === null || isNaN(row[k])) { row[k] = parseFloat(mean.toFixed(4)); replaced++; } }); });
            $('#preprocess-status').text(replaced === 0 ? '✨ Dữ liệu đầy đủ!' : `✅ Đã điền trung bình cho ${replaced} ô trống.`);
        } else if (type === 'drop-col') {
            const col = $('#filter-col-select').val(); newData = parsedData.map(row => { const r = { ...row }; delete r[col]; return r; });
            $('#preprocess-status').text(`✅ Đã xóa thuộc tính: ${col}`);
        } else if (type === 'remove-duplicates') {
            const seen = new Set(); newData = parsedData.filter(row => { const r = { ...row }; delete r._originalId; const s = JSON.stringify(r); if (seen.has(s)) return false; seen.add(s); return true; });
            const r = parsedData.length - newData.length; $('#preprocess-status').text(r === 0 ? '✨ Không có dòng trùng lặp.' : `✅ Đã xóa ${r} dòng trùng lặp.`);
        } else if (type === 'remove-outliers') {
            const allKeys = Object.keys(parsedData[0]).filter(k => k !== '_originalId');
            const numKeys = allKeys.filter((k, idx) => { return typeof parsedData[0][k] === 'number' && (idx !== allKeys.length - 1) && k !== 'species_id' && k !== 'id'; });
            const outlierData = getOutlierData(parsedData, numKeys); 
            newData = parsedData.filter((row, idx) => !outlierData.indices.has(idx));
            const r = parsedData.length - newData.length; 
            $('#preprocess-status').text(r === 0 ? '✨ Không tìm thấy ngoại lai để xóa.' : `✅ Đã xóa hoàn toàn ${r} dòng chứa giá trị ngoại lai nông học.`);
        } else if (type === 'winsorize-outliers') {
            const allKeys = Object.keys(parsedData[0]).filter(k => k !== '_originalId');
            const numKeys = allKeys.filter((k, idx) => { return typeof parsedData[0][k] === 'number' && (idx !== allKeys.length - 1) && k !== 'species_id' && k !== 'id'; });
            const thresholds = {};
            numKeys.forEach(k => { thresholds[k] = getIqrThresholds(parsedData, k); });

            let modifiedCells = 0;
            let modifiedRows = new Set();

            newData = parsedData.map((row, idx) => {
                const newRow = { ...row };
                numKeys.forEach(k => {
                    const t = thresholds[k];
                    if (t && typeof newRow[k] === 'number' && !isNaN(newRow[k])) {
                        if (newRow[k] > t.upperOutlier) {
                            newRow[k] = parseFloat(t.upperOutlier.toFixed(4));
                            modifiedCells++;
                            modifiedRows.add(idx);
                        } else if (newRow[k] < t.lowerOutlier) {
                            newRow[k] = parseFloat(t.lowerOutlier.toFixed(4));
                            modifiedCells++;
                            modifiedRows.add(idx);
                        }
                    }
                });
                return newRow;
            });
            $('#preprocess-status').text(`✅ Đã chặn biên (Winsorization) làm mượt ${modifiedCells} giá trị trên ${modifiedRows.size} giống cây trồng. Bảo toàn trọn vẹn 22 mẫu.`);
        } else if (type === 'normalize-minmax') {
            newData = JSON.parse(JSON.stringify(parsedData)); const nk = Object.keys(newData[0]).filter(k => typeof newData[0][k] === 'number' && k !== '_originalId');
            const params = getNormalizationParams(parsedData, nk); newData.forEach(row => { nk.forEach(k => { if (typeof row[k] === 'number') row[k] = parseFloat(((row[k] - params[k].min) / params[k].range).toFixed(4)); }); });
            $('#preprocess-status').text(`✅ Đã chuẩn hóa Min-Max [0,1] cho ${nk.length} thuộc tính số.`);
        } else if (type === 'standardize-zscore') {
            newData = JSON.parse(JSON.stringify(parsedData)); const nk = Object.keys(newData[0]).filter(k => typeof newData[0][k] === 'number' && k !== '_originalId');
            const params = getZScoreParams(parsedData, nk); newData.forEach(row => { nk.forEach(k => { if (typeof row[k] === 'number') row[k] = parseFloat(((row[k] - params[k].mean) / params[k].std).toFixed(4)); }); });
            $('#preprocess-status').text(`✅ Đã chuẩn hóa Z-score (Mean=0, Std=1) cho ${nk.length} thuộc tính.`);
        } else if (type === 'normalize-robust') {
            newData = JSON.parse(JSON.stringify(parsedData)); 
            const nk = Object.keys(newData[0]).filter(k => typeof newData[0][k] === 'number' && k !== '_originalId');
            const params = getRobustParams(parsedData, nk); 
            newData.forEach(row => { 
                nk.forEach(k => { 
                    if (typeof row[k] === 'number') {
                        row[k] = parseFloat(((row[k] - params[k].median) / params[k].iqr).toFixed(4)); 
                    }
                }); 
            });
            isDataNormalized = true;
            $('#preprocess-status').text(`✅ Đã áp dụng Robust Scaling (Sử dụng Median & IQR) bền vững cho ${nk.length} thuộc tính số.`);
        }
        parsedData = newData; renderPreprocessTable(parsedData); renderDataLoader(parsedData); $('#alert-container').empty();
    });

    $('#btnRun').on('click', function () {
        if (parsedData.length === 0) { showAppMessage('Chưa nạp dữ liệu', 'Vui lòng tải tệp dữ liệu trong mục Data Loader trước.', 'error'); return; }
        const k = parseInt($('#kValue').val()) || 3; const seedValue = parseInt($('#randomSeed').val()) || 10; setSeed(seedValue);
        let selectedFeatures = []; $('#featuresList input:checked').each(function () { selectedFeatures.push($(this).val()); });
        if (selectedFeatures.length < 1) { showAppMessage('Tham số trống', 'Vui lòng chọn ít nhất 1 thuộc tính nông học để thực thi gom cụm.', 'error'); return; }
        
        let filteredData = parsedData.map(row => { 
            const obj = { _originalId: row._originalId }; 
            selectedFeatures.forEach(f => { obj[f] = row[f]; }); 
            if (row.name !== undefined) { obj.name = row.name; }
            return obj; 
        });
        
        const evalKeys = selectedFeatures.filter(k => k !== '_originalId');
        buildDomains(filteredData, evalKeys); 
        
        let workingData;
        if (isDataNormalized) {
            workingData = filteredData;
        } else {
            workingData = normalizeData(filteredData, getNormalizationParams(filteredData, selectedFeatures.filter(f => typeof filteredData[0][f] === 'number')));
        }

        const algo = $('#algorithm').val() || 'kmeans'; 
        const evalMethod = $('input[name="testopt"]:checked').val() || 'training';
        let clusterResults = []; 
        let hcInstance = null;
        let modelInstance = null;

        let trainData = [...workingData];
        let testData = [];
        
        if (evalMethod === 'split' && algo !== 'hierarchical') {
            const jRand = new LcgRandom(seedValue);
            const tempArr = [...workingData];
            for (let i = tempArr.length - 1; i > 0; i--) {
                const j = jRand.nextInt(i + 1);
                const temp = tempArr[i];
                tempArr[i] = tempArr[j];
                tempArr[j] = temp;
            }
            const splitIdx = Math.floor(tempArr.length * 0.8);
            trainData = tempArr.slice(0, splitIdx);
            testData = tempArr.slice(splitIdx);
            
            if (trainData.length === 0 || testData.length === 0) {
                showAppMessage('Lỗi phân tách', 'Dữ liệu quá ít để chia tỉ lệ 80/20. Tự động chuyển về Use training set.', 'error');
                trainData = [...workingData];
                testData = [];
                $('input[name="testopt"][value="training"]').prop('checked', true);
            }
        }
        
        if (algo === 'kmeans') {
            modelInstance = new KMeans(k, trainData);
            clusterResults = modelInstance.run();
        } else if (algo === 'hierarchical') {
            hcInstance = new HierarchicalClustering(null, workingData, $('#hcLinkageType').val() || 'SINGLE');
            hcInstance.run();
        } else if (algo === 'gmm') {
            const maxIter = parseInt($('#gmmMaxIter').val()) || 50;
            modelInstance = new GaussianMixture(k, trainData);
            clusterResults = modelInstance.run(maxIter);
        } else if (algo === 'clara') {
            modelInstance = new CLARA(k, trainData);
            clusterResults = modelInstance.run();
        }
        
        // KIỂM SOÁT HIỂN THỊ ĐỘNG VÀ ĐỔI TÊN ĐẦU ĐỀ QUY TRÌNH QUAN SÁT
        if (algo === 'hierarchical') {
            $('#empty-results').hide(); $('#resultSection').show();
            $('#visCardTitle').text('Cluster Tree Visualizer'); // Header cho cây phân cấp di truyền
            $('#visCard').show();
            $('#metricsCard').hide();
            $('#tableCard').hide();
            if (hcInstance && hcInstance.tree) drawDendrogram(document.getElementById('scatterChart'), hcInstance.tree);
        } else {
            let finalSSE = 0;
            
            if (evalMethod === 'split' && modelInstance) {
                const testClusters = assignTestData(modelInstance, testData, algo);
                finalSSE = calculateSSE(testClusters, evalKeys);
                
                $('#evalK').text(modelInstance.k || clusterResults.length);
                $('#evalInstances').text(testData.length + ' / ' + workingData.length + ' (Test Split)');
                $('#evalSSE').text(finalSSE.toFixed(4) + ' (Test SSE)');
                
                const fullMappedClusters = assignTestData(modelInstance, workingData, algo);
                displayResults = fullMappedClusters.map(c => c.map(p => { 
                    const orig = parsedData.find(x => x._originalId === p._originalId); 
                    const cln = {}; 
                    selectedFeatures.forEach(f => { cln[f] = orig[f]; }); 
                    return cln; 
                }));
            } else {
                let total = 0; clusterResults.forEach(c => total += c.length); const actualK = clusterResults.length;
                $('#evalK').text(actualK); $('#evalInstances').text(total.toLocaleString() + ' (Full Training)');
                
                if ((algo === 'kmeans' || algo === 'clara') && clusterResults.model && typeof clusterResults.model.squaredError === 'number') {
                    finalSSE = clusterResults.model.squaredError;
                } else {
                    finalSSE = calculateSSE(clusterResults, evalKeys);
                }
                $('#evalSSE').text(finalSSE.toFixed(4));
                
                displayResults = clusterResults.map(c => c.map(p => { 
                    const orig = parsedData.find(x => x._originalId === p._originalId); 
                    const cln = {}; 
                    selectedFeatures.forEach(f => { cln[f] = orig[f]; }); 
                    return cln; 
                }));
            }
            
            $('#empty-results').hide(); $('#resultSection').show();
            $('#visCardTitle').text('Cluster Visualization'); // Header cho thuật toán phân hoạch
            $('#visCard').show();
            $('#metricsCard').show();
            $('#tableCard').show();

            document.getElementById('scatterChart').style.height = '350px';
            renderChart(displayResults); renderClusterTables(displayResults);
        }
    });

    $('#btnExport').on('click', function () {
        if ($('#algorithm').val() === 'hierarchical') {
            showAppMessage('Không thể xuất dữ liệu phân cụm', 'Giải thuật phân cấp hiện tại chỉ tập trung biểu diễn sơ đồ quan hệ Dendrogram di truyền phân nhánh, không sinh nhãn nhóm rời rạc. Vui lòng chọn giải thuật khác (như K-Means) để xuất tệp Excel.', 'error'); return;
        }
        if (!displayResults || displayResults.length === 0) { showAppMessage('Chưa có kết quả', 'Chưa tìm thấy dữ liệu kết quả gom cụm để xuất tệp!', 'error'); return; }
        let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"></head><body>`;
        html += `<h2>Performance Metrics</h2><table border="1" style="border-collapse:collapse;text-align:center;"><tr style="background:#e0e7ff;font-weight:bold;"><th>Clusters</th><th>Instances</th><th>SSE</th></tr>`;
        html += `<tr><td>${$('#evalK').text()}</td><td>${$('#evalInstances').text()}</td><td>${$('#evalSSE').text()}</td></tr></table><br>`;
        html += `<h2>Cluster Assignments</h2><table border="1" style="border-collapse:collapse;text-align:center;"><tr style="background:#ecfdf5;font-weight:bold;"><th>Nhóm</th><th>STT</th>`;
        const keys = Object.keys(displayResults[0][0]).filter(k => k !== '_originalId');
        keys.forEach(k => html += `<th>${k}</th>`); html += `</tr>`;
        displayResults.forEach((cluster, cIdx) => { cluster.forEach((row, rIdx) => { html += `<tr><td style="font-weight:bold;color:#4f46e5">Nhóm ${cIdx + 1}</td><td>${rIdx + 1}</td>`; keys.forEach(k => { let v = row[k]; if (typeof v === 'number' && !Number.isInteger(v)) v = v.toFixed(4); html += `<td>${v}</td>`; }); html += `</tr>`; }); });
        html += `</table></body></html>`;
        const blob = new Blob([html], { type: 'application/vnd.ms-excel' }); const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'Ket_Qua_Gom_Cum_Nong_Nghiep.xls'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    });

    $('#btnExportCSV').on('click', function () {
        if ($('#algorithm').val() === 'hierarchical') { showAppMessage('Tính năng không hỗ trợ', 'Không thể xuất danh sách phân nhóm khi đang sử dụng chế độ Dendrogram phân cấp toàn phần.', 'error'); return; }
        if (!displayResults || displayResults.length === 0) { showAppMessage('Chưa có kết quả', 'Vui lòng thực thi phân cụm trước khi xuất CSV!', 'error'); return; }
        const keys = Object.keys(displayResults[0][0]).filter(k => k !== '_originalId');
        let csv = keys.join(',') + ',Cluster_Assignment\n';
        displayResults.forEach((cluster, cIdx) => { cluster.forEach(row => { const vals = keys.map(k => { let v = row[k]; return (typeof v === 'number' && !Number.isInteger(v)) ? v.toFixed(4) : v; }); csv += vals.join(',') + `,cluster_${cIdx + 1}\n`; }); });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'Ket_Qua_Gom_Cum_Nong_Nghiep.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    });

    $('#btnExportARFF').on('click', function () {
        if ($('#algorithm').val() === 'hierarchical') { showAppMessage('Tính năng không hỗ trợ', 'Không thể xuất danh sách phân nhóm khi đang sử dụng chế độ Dendrogram phân cấp toàn phần.', 'error'); return; }
        if (!displayResults || displayResults.length === 0) { showAppMessage('Chưa có kết quả', 'Vui lòng thực thi phân cụm trước khi xuất ARFF!', 'error'); return; }
        const keys = Object.keys(displayResults[0][0]).filter(k => k !== '_originalId');
        const relName = ($('#fileName').text() || 'WikiCrop_Mining').replace('.csv', '');
        let arff = `@relation ${relName}\n\n`;
        keys.forEach(k => { arff += `@attribute ${k} numeric\n`; });
        arff += `@attribute Cluster_Assignment {${displayResults.map((_, i) => `cluster_${i + 1}`).join(',')}}\n\n@data\n`;
        displayResults.forEach((cluster, cIdx) => { cluster.forEach(row => { const vals = keys.map(k => { let v = row[k]; return (typeof v === 'number' && !Number.isInteger(v)) ? v.toFixed(4) : v; }); arff += vals.join(',') + `,cluster_${cIdx + 1}\n`; }); });
        const blob = new Blob([arff], { type: 'text/plain;charset=utf-8;' }); const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'Ket_Qua_Gom_Cum_Nong_Nghiep.arff'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    });

    $('#algorithm').trigger('change');
});