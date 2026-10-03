# Design notes

Why each decision was made, what was tried and dropped, and what the numbers changed.

## 1. Portable exp and log in the simulator
**Chose:** pure-JavaScript ports of fdlibm's `exp` and `log` (`src/domain/fmath.ts`), and the Marsaglia polar method for normal draws instead of Box-Muller.
**Because:** the determinism test compares a SHA-256 of seed 7's frames, generated on an arm64 Mac, against the same run on CI's x64 runner. JavaScript arithmetic is correctly rounded everywhere, but the engine's `Math.exp`, `Math.log`, `Math.sin` and `Math.cos` are compiled C++ and can differ in the last bit between CPU architectures.
**Tried first / what went wrong:** the first version used the native functions and Box-Muller. The hash matched locally and failed on CI with a different digest. With the ports (checked against the native functions to within 1 ulp) the frames are byte-identical on both machines. The polar method needs only `log` and `sqrt`, so no trigonometry is left in the simulator.

## 2. Hot-loop constants as locals
**Chose:** copy imported constants into local variables inside the per-tick loops.
**Because:** a first benchmark run from outside the package compiled the domain modules as CommonJS, and every imported constant in the 10 Hz loop became a getter call. The run took 0.53 ms; with locals and a precomputed table for the pumpdown decay it takes about 0.15 ms, so the full eval (about 1.05 million simulated runs) finishes in under 3 minutes on a laptop.

## 3. One SPC function for both tool health and the thickness trend
**Chose:** every chart is observed / expected - 1 with center 0, sigma from the RMS over Phase I (runs 1-50), and an alarm is rule 1 at 4 sigma or an EWMA (lambda 0.2) beyond a calibrated limit. The thickness trend and lotline use the same function and are calibrated to the same false-alarm target on separate calibration tools.
**Because:** the comparison is only fair if both detectors pay the same false-alarm price. A moving-range sigma misses the per-recipe-version rate error that thickness carries, which leaves the thickness trend impossible to calibrate; the RMS about zero includes it.

## 4. Parameters were not tuned
**Chose:** the T step (check the headline cell, adjust only within stated constraints, freeze) made no changes. The pinned plant and loop values passed every settling test, and the headline cell came out close to the pre-build estimate.
**Because:** tuning until the new method wins is how a result like this gets rigged. The numbers in `results/` are reported as they came out, including where the thickness trend does as well or better.
