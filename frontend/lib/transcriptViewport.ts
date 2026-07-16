interface ScrollMetrics {
    scrollTop: number;
    clientHeight: number;
    scrollHeight: number;
}

export function shouldStickToLatest(metrics: ScrollMetrics, threshold = 56): boolean {
    return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= threshold;
}
