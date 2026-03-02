// Charts JavaScript - Chart.js Integration
// Dark theme · Gradient fills · Smooth animations

let dailyChart = null;
let agreementChart = null;

// Set Chart.js global dark theme defaults
Chart.defaults.color = '#94a3b8';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.font.size = 12;

async function loadCharts() {
    try {
        const response = await fetch('/api/analytics/daily?days=30');
        const data = await response.json();

        renderDailyChart(data);
        renderAgreementChart(data);
    } catch (error) {
        console.error('Error loading charts:', error);
    }
}

function renderDailyChart(data) {
    const ctx = document.getElementById('dailyChart').getContext('2d');

    if (dailyChart) dailyChart.destroy();

    const labels = data.map(d => {
        const date = new Date(d.date);
        return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    });

    const totalCalls = data.map(d => d.total_calls);
    const agreedCalls = data.map(d => d.agreed_calls);

    dailyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Total Calls',
                    data: totalCalls,
                    backgroundColor: 'rgba(99, 102, 241, 0.45)',
                    borderColor: 'rgba(99, 102, 241, 0.9)',
                    borderWidth: 1.5,
                    borderRadius: 6,
                    hoverBackgroundColor: 'rgba(99, 102, 241, 0.7)',
                },
                {
                    label: 'Agreed',
                    data: agreedCalls,
                    backgroundColor: 'rgba(16, 185, 129, 0.45)',
                    borderColor: 'rgba(16, 185, 129, 0.9)',
                    borderWidth: 1.5,
                    borderRadius: 6,
                    hoverBackgroundColor: 'rgba(16, 185, 129, 0.7)',
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            animation: { duration: 800, easing: 'easeOutQuart' },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'rectRounded',
                        padding: 20,
                        font: { weight: '600' }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#f1f5f9',
                    bodyColor: '#94a3b8',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 14,
                    cornerRadius: 10,
                    displayColors: true,
                    boxPadding: 6,
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0, padding: 8 },
                    grid: { color: 'rgba(255, 255, 255, 0.04)', drawBorder: false },
                    border: { display: false }
                },
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { padding: 6 }
                }
            }
        }
    });
}

function renderAgreementChart(data) {
    const ctx = document.getElementById('agreementChart').getContext('2d');

    if (agreementChart) agreementChart.destroy();

    const labels = data.map(d => {
        const date = new Date(d.date);
        return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    });

    const agreementRates = data.map(d => d.agreement_rate);

    // Create gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    gradient.addColorStop(0, 'rgba(129, 140, 248, 0.25)');
    gradient.addColorStop(1, 'rgba(129, 140, 248, 0.02)');

    agreementChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Agreement Rate (%)',
                data: agreementRates,
                fill: true,
                backgroundColor: gradient,
                borderColor: 'rgba(129, 140, 248, 1)',
                borderWidth: 2.5,
                tension: 0.4,
                pointBackgroundColor: 'rgba(129, 140, 248, 1)',
                pointBorderColor: '#0a0f1e',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 7,
                pointHoverBackgroundColor: '#fff',
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            animation: { duration: 1000, easing: 'easeOutQuart' },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 20,
                        font: { weight: '600' }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#f1f5f9',
                    bodyColor: '#94a3b8',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 14,
                    cornerRadius: 10,
                    callbacks: {
                        label: function (context) {
                            return `Agreement Rate: ${context.parsed.y.toFixed(1)}%`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        callback: v => v + '%',
                        padding: 8,
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.04)', drawBorder: false },
                    border: { display: false }
                },
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { padding: 6 }
                }
            }
        }
    });
}
