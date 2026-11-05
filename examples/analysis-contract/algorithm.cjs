'use strict';

const isPositive = value => value > 0;

function sumPositiveUntil(values, limit) {
    if (limit <= 0) {
        return 0;
    }
    let total = 0;
    for (let index = 0; index < values.length; index++) {
        const value = values[index];
        if (
            !Number.isFinite(value)
            || !isPositive(value)
        ) {
            continue;
        }
        total += value;
        if (total >= limit) {
            return total;
        }
    }
    return total;
}

module.exports = {isPositive, sumPositiveUntil};
