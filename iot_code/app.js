/* ============================================
   Professional Smart-Watch Health Monitor
   JavaScript Application Logic
   Created by: OMAR GOUDA
   Team: Egyptian Chinese University Team (ECU)
   ============================================ */

// ============================================
// Configuration & State Management
// ============================================

let bluetoothDevice = null;
let bluetoothCharacteristic = null;
let isConnected = false;
let dataUpdateInterval = null;

// Chart instances
let hrChart = null;
let spChart = null;
let tempChart = null;
let batChart = null;
let activityHrChart = null;
let activitySpChart = null;
let activityTempChart = null;
let activityBatChart = null;

// Data storage
let sensorData = {
  heartRate: [],
  oxygen: [],
  temperature: [],
  battery: [],
  timestamps: []
};

// Settings
let settings = {
  hrHighThreshold: 100,
  hrLowThreshold: 60,
  spLowThreshold: 95,
  tempHighThreshold: 37.5,
  tempLowThreshold: 36.5,
  batLowThreshold: 20,
  refreshInterval: 5,
  chartDataPoints: 20,
  autoReconnect: true,
  emailAlertsEnabled: true,
  alertEmail: ''
};

// User profile
let userProfile = {
  name: 'User Name',
  email: '',
  emergencyPhone: '',
  emergencyEmail: ''
};

// Firebase Configuration (using existing config from original file)
const firebaseConfig = {
  apiKey: "AIzaSyDvhMOPLbL_k6vvBDOjRYglO5io3wbOMTU",
  authDomain: "health-monitor-438c2.firebaseapp.com",
  databaseURL: "https://health-monitor-438c2-default-rtdb.firebaseio.com",
  projectId: "health-monitor-438c2"
};

// Initialize Firebase (if available)
let database = null;
let dbRef = null;
let firebaseInitialized = false;

// Initialize Firebase asynchronously
async function initializeFirebase() {
  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js");
    const { getDatabase, ref, onValue } = await import("https://www.gstatic.com/firebasejs/10.4.0/firebase-database.js");
    
    const app = initializeApp(firebaseConfig);
    database = getDatabase(app);
    dbRef = ref(database, 'sensorData');
    firebaseInitialized = true;
    
    // Listen for real-time updates from Firebase
    onValue(dbRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        // Process latest data entry
        const entries = Object.values(data);
        if (entries.length > 0) {
          const latest = entries[entries.length - 1];
          processSensorData(latest);
        }
      }
    });
    
    console.log('Firebase initialized successfully');
  } catch (error) {
    console.warn('Firebase not available, using local storage:', error);
    firebaseInitialized = false;
  }
}

// Initialize Firebase on load
initializeFirebase();

// ============================================
// Page Navigation
// ============================================

function showPage(pageId) {
  try {
    console.log('Switching to page:', pageId);
    
    // Hide all pages
    const allPages = document.querySelectorAll('.page-content');
    allPages.forEach(page => {
      page.classList.remove('active');
    });
    
    // Show selected page
    const targetPage = document.getElementById(`${pageId}-page`);
    if (targetPage) {
      targetPage.classList.add('active');
      console.log('Page shown:', pageId);
    } else {
      console.error('Page not found:', `${pageId}-page`);
    }
    
    // Update tab buttons
    const allTabs = document.querySelectorAll('.tab-btn');
    allTabs.forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.page === pageId || btn.getAttribute('onclick')?.includes(pageId)) {
        btn.classList.add('active');
      }
    });
    
    // Initialize map if switching to dashboard
    if (pageId === 'dashboard' && gpsManager && !gpsManager.mapInitialized) {
      setTimeout(() => {
        gpsManager.initMap();
      }, 100);
    }
    
    // Refresh charts if on activity page
    if (pageId === 'activity') {
      setTimeout(() => {
        if (typeof updateActivityCharts === 'function') {
          updateActivityCharts();
        }
      }, 100);
    }
  } catch (error) {
    console.error('Error in showPage:', error);
  }
}

// ============================================
// Bluetooth Connection
// ============================================

async function connectBluetooth() {
  if (!navigator.bluetooth) {
    alert('البلوتوث غير مدعوم في هذا المتصفح. يرجى استخدام Chrome أو Edge.\n\nBluetooth is not supported in this browser. Please use Chrome or Edge.');
    return;
  }
  
  try {
    const bluetoothBtn = document.getElementById('bluetoothBtn');
    const bluetoothText = document.getElementById('bluetoothText');
    
    if (bluetoothBtn) bluetoothBtn.disabled = true;
    if (bluetoothText) bluetoothText.textContent = 'جار البحث... / Scanning...';
    
    // Request Bluetooth device
    bluetoothDevice = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'ESP32' },
        { namePrefix: 'SmartWatch' },
        { services: ['heart_rate'] }
      ],
      optionalServices: [
        'battery_service',
        'device_information',
        '0000ff00-0000-1000-8000-00805f9b34fb' // Custom service UUID
      ]
    });
    
    bluetoothText.textContent = 'Connecting...';
    
    // Connect to GATT server
    const server = await bluetoothDevice.gatt.connect();
    
    // Get primary service (using heart rate service as example)
    // In real implementation, use your ESP32's service UUID
    let service;
    try {
      service = await server.getPrimaryService('heart_rate');
    } catch (e) {
      // Try custom service UUID
      service = await server.getPrimaryService('0000ff00-0000-1000-8000-00805f9b34fb');
    }
    
    // Get characteristic for notifications
    bluetoothCharacteristic = await service.getCharacteristic('heart_rate_measurement');
    
    // Start notifications
    await bluetoothCharacteristic.startNotifications();
    bluetoothCharacteristic.addEventListener('characteristicvaluechanged', handleBluetoothData);
    
    // Update UI
    isConnected = true;
    updateConnectionStatus(true);
    bluetoothText.textContent = 'Connected';
    bluetoothBtn.classList.add('connected');
    
    // Update device info in system status
    if (systemStatus) {
      systemStatus.updateDeviceInfo({
        name: bluetoothDevice.name || 'ESP32 Smart Watch',
        connected: true,
        firmware: 'v1.0.0', // This would come from device
        rssi: bluetoothDevice.gatt?.server?.rssi || -70 // Mock RSSI
      });
    }
    
    // Listen for disconnection
    bluetoothDevice.addEventListener('gattserverdisconnected', onBluetoothDisconnected);
    
    // Start data update interval
    startDataUpdateInterval();
    
  } catch (error) {
    console.error('Bluetooth connection error:', error);
    const errorMsg = error.message || 'Unknown error';
    alert(`فشل الاتصال بالبلوتوث / Failed to connect:\n${errorMsg}\n\nتأكد من:\n- تفعيل البلوتوث\n- أن الجهاز قريب\n- استخدام Chrome أو Edge`);
    updateConnectionStatus(false);
    const bluetoothText = document.getElementById('bluetoothText');
    const bluetoothBtn = document.getElementById('bluetoothBtn');
    if (bluetoothText) bluetoothText.textContent = 'اتصال بالساعة الذكية / Connect to Smart Watch';
    if (bluetoothBtn) bluetoothBtn.disabled = false;
  }
}

function handleBluetoothData(event) {
  const value = event.target.value;
  
  // Parse data from ESP32
  // Format: "HR:75,SPO2:98,TEMP:36.8,BAT:85"
  const dataView = value;
  const decoder = new TextDecoder('utf-8');
  const dataString = decoder.decode(dataView);
  
  // Parse sensor data
  const data = parseSensorData(dataString);
  if (data) {
    processSensorData(data);
  }
}

function parseSensorData(dataString) {
  try {
    // Try to parse JSON first
    if (dataString.startsWith('{')) {
      return JSON.parse(dataString);
    }
    
    // Parse comma-separated format: "HR:75,SPO2:98,TEMP:36.8,BAT:85"
    const parts = dataString.split(',');
    const data = {};
    
    parts.forEach(part => {
      const [key, value] = part.split(':');
      if (key && value) {
        const cleanKey = key.trim().toUpperCase();
        const cleanValue = parseFloat(value.trim());
        
        if (cleanKey.includes('HR') || cleanKey.includes('HEART')) {
          data.heartRate = cleanValue;
        } else if (cleanKey.includes('SPO2') || cleanKey.includes('OXYGEN')) {
          data.oxygen = cleanValue;
        } else if (cleanKey.includes('TEMP') || cleanKey.includes('TEMPERATURE')) {
          data.temperature = cleanValue;
        } else if (cleanKey.includes('BAT') || cleanKey.includes('BATTERY')) {
          data.battery = cleanValue;
        }
      }
    });
    
    return Object.keys(data).length > 0 ? data : null;
  } catch (error) {
    console.error('Error parsing sensor data:', error);
    return null;
  }
}

function onBluetoothDisconnected() {
  isConnected = false;
  updateConnectionStatus(false);
  document.getElementById('bluetoothText').textContent = 'Connect to Smart Watch';
  document.getElementById('bluetoothBtn').classList.remove('connected');
  document.getElementById('bluetoothBtn').disabled = false;
  
  if (settings.autoReconnect) {
    setTimeout(() => {
      if (!isConnected) {
        connectBluetooth();
      }
    }, 3000);
  }
}

function disconnectBluetooth() {
  if (bluetoothDevice && bluetoothDevice.gatt.connected) {
    bluetoothDevice.gatt.disconnect();
  }
  isConnected = false;
  updateConnectionStatus(false);
  document.getElementById('bluetoothText').textContent = 'Connect to Smart Watch';
  document.getElementById('bluetoothBtn').classList.remove('connected');
  document.getElementById('bluetoothBtn').disabled = false;
  
  if (dataUpdateInterval) {
    clearInterval(dataUpdateInterval);
    dataUpdateInterval = null;
  }
}

function startDataUpdateInterval() {
  if (dataUpdateInterval) {
    clearInterval(dataUpdateInterval);
  }
  
  // Always simulate data updates for testing (even if connected)
  // In production, this would only run if Bluetooth is not available
  dataUpdateInterval = setInterval(() => {
    try {
      // Simulate sensor data for testing
      const mockData = {
        heartRate: Math.floor(Math.random() * 40) + 60, // 60-100
        oxygen: Math.floor(Math.random() * 5) + 95, // 95-100
        temperature: (Math.random() * 1.5 + 36.5).toFixed(1), // 36.5-38
        battery: Math.floor(Math.random() * 30) + 70 // 70-100
      };
      processSensorData(mockData);
    } catch (error) {
      console.error('Error in data update interval:', error);
    }
  }, (settings.refreshInterval || 5) * 1000);
}

// ============================================
// Data Processing & Updates
// ============================================

function processSensorData(data) {
  const timestamp = new Date();
  
  // Update sensor data arrays
  if (data.heartRate !== undefined) {
    sensorData.heartRate.push({ value: data.heartRate, time: timestamp });
    updateMetric('hr', data.heartRate, timestamp);
  }
  
  if (data.oxygen !== undefined) {
    sensorData.oxygen.push({ value: data.oxygen, time: timestamp });
    updateMetric('sp', data.oxygen, timestamp);
  }
  
  if (data.temperature !== undefined) {
    const temp = parseFloat(data.temperature);
    sensorData.temperature.push({ value: temp, time: timestamp });
    updateMetric('temp', temp, timestamp);
  }
  
  if (data.battery !== undefined) {
    sensorData.battery.push({ value: data.battery, time: timestamp });
    updateMetric('bat', data.battery, timestamp);
  }
  
  // Limit data points
  const maxPoints = settings.chartDataPoints;
  ['heartRate', 'oxygen', 'temperature', 'battery'].forEach(key => {
    if (sensorData[key].length > maxPoints) {
      sensorData[key] = sensorData[key].slice(-maxPoints);
    }
  });
  
  // Update charts
  updateCharts();
  
  // Update virtual watch
  if (virtualWatch) {
    virtualWatch.updateMetrics(data);
  }
  
  // Add to session recorder
  if (sessionRecorder && sessionRecorder.isRecording) {
    const location = gpsManager?.getCurrentLocation();
    sessionRecorder.addData({
      ...data,
      lat: location?.lat,
      lng: location?.lng
    });
  }
  
  // Add to log
  addToLog(data, timestamp);
  
  // Check thresholds and send alerts
  checkThresholds(data);
  
  // Save to database
  saveToDatabase(data, timestamp);
  
  // Update system status
  if (systemStatus) {
    systemStatus.recordPacket(true);
  }
}

function updateMetric(type, value, timestamp) {
  const valueElement = document.getElementById(`${type}Value`);
  const smallElement = document.getElementById(`${type}Small`);
  const trendElement = document.getElementById(`${type}Trend`);
  
  if (valueElement) {
    valueElement.textContent = type === 'temp' ? `${value}°C` : 
                              type === 'bat' ? `${value}%` :
                              type === 'sp' ? `${value}%` : 
                              `${value} bpm`;
  }
  
  if (smallElement) {
    smallElement.textContent = `Last update: ${timestamp.toLocaleTimeString()}`;
  }
  
  // Update trend indicator
  if (trendElement) {
    let status = 'Normal';
    let trendClass = 'trend-up';
    
    if (type === 'hr') {
      if (value > settings.hrHighThreshold || value < settings.hrLowThreshold) {
        status = 'Warning';
        trendClass = 'trend-down';
      }
    } else if (type === 'sp') {
      if (value < settings.spLowThreshold) {
        status = 'Low';
        trendClass = 'trend-down';
      }
    } else if (type === 'temp') {
      if (value > settings.tempHighThreshold || value < settings.tempLowThreshold) {
        status = 'Warning';
        trendClass = 'trend-warning';
      }
    } else if (type === 'bat') {
      if (value < settings.batLowThreshold) {
        status = 'Low';
        trendClass = 'trend-warning';
      }
    }
    
    trendElement.className = `metric-trend ${trendClass}`;
    trendElement.innerHTML = `<i class="fas fa-${trendClass === 'trend-up' ? 'check' : trendClass === 'trend-down' ? 'arrow-down' : 'exclamation-triangle'}"></i> <span>${status}</span>`;
  }
}

// ============================================
// Charts
// ============================================

function initializeCharts() {
  // Heart Rate Chart
  const hrCtx = document.getElementById('hrChart');
  if (hrCtx) {
    hrChart = new Chart(hrCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Heart Rate (bpm)',
          data: [],
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: false,
            min: 50,
            max: 120,
            grid: { color: 'rgba(148, 163, 184, 0.1)' }
          },
          x: { grid: { display: false } }
        }
      }
    });
  }
  
  // SpO2 Chart
  const spCtx = document.getElementById('spChart');
  if (spCtx) {
    spChart = new Chart(spCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'SpO₂ (%)',
          data: [],
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: false,
            min: 90,
            max: 100,
            grid: { color: 'rgba(148, 163, 184, 0.1)' }
          },
          x: { grid: { display: false } }
        }
      }
    });
  }
  
  // Temperature Chart
  const tempCtx = document.getElementById('tempChart');
  if (tempCtx) {
    tempChart = new Chart(tempCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Temperature (°C)',
          data: [],
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: false,
            min: 35,
            max: 39,
            grid: { color: 'rgba(148, 163, 184, 0.1)' }
          },
          x: { grid: { display: false } }
        }
      }
    });
  }
  
  // Battery Chart
  const batCtx = document.getElementById('batChart');
  if (batCtx) {
    batChart = new Chart(batCtx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          label: 'Battery (%)',
          data: [],
          backgroundColor: 'rgba(16, 185, 129, 0.6)',
          borderColor: '#10b981',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            grid: { color: 'rgba(148, 163, 184, 0.1)' }
          },
          x: { grid: { display: false } }
        }
      }
    });
  }
  
  // Activity Charts (similar structure)
  initializeActivityCharts();
}

function initializeActivityCharts() {
  const charts = [
    { id: 'activityHrChart', color: '#ef4444', label: 'Heart Rate' },
    { id: 'activitySpChart', color: '#06b6d4', label: 'SpO₂' },
    { id: 'activityTempChart', color: '#f59e0b', label: 'Temperature' },
    { id: 'activityBatChart', color: '#10b981', label: 'Battery' }
  ];
  
  charts.forEach(({ id, color, label }) => {
    const ctx = document.getElementById(id);
    if (ctx) {
      window[id.replace('activity', '').replace('Chart', 'Chart')] = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: label,
            data: [],
            borderColor: color,
            backgroundColor: color + '20',
            tension: 0.4,
            fill: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true }
          },
          scales: {
            y: {
              grid: { color: 'rgba(148, 163, 184, 0.1)' }
            },
            x: { grid: { display: false } }
          }
        }
      });
    }
  });
}

function updateCharts() {
  const maxPoints = settings.chartDataPoints;
  
  // Update Heart Rate Chart
  if (hrChart && sensorData.heartRate.length > 0) {
    const data = sensorData.heartRate.slice(-maxPoints);
    hrChart.data.labels = data.map((_, i) => i);
    hrChart.data.datasets[0].data = data.map(d => d.value);
    hrChart.update('none');
  }
  
  // Update SpO2 Chart
  if (spChart && sensorData.oxygen.length > 0) {
    const data = sensorData.oxygen.slice(-maxPoints);
    spChart.data.labels = data.map((_, i) => i);
    spChart.data.datasets[0].data = data.map(d => d.value);
    spChart.update('none');
  }
  
  // Update Temperature Chart
  if (tempChart && sensorData.temperature.length > 0) {
    const data = sensorData.temperature.slice(-maxPoints);
    tempChart.data.labels = data.map((_, i) => i);
    tempChart.data.datasets[0].data = data.map(d => d.value);
    tempChart.update('none');
  }
  
  // Update Battery Chart
  if (batChart && sensorData.battery.length > 0) {
    const data = sensorData.battery.slice(-maxPoints);
    batChart.data.labels = data.map((_, i) => i);
    batChart.data.datasets[0].data = data.map(d => d.value);
    batChart.update('none');
  }
}

function updateActivityCharts() {
  // Similar to updateCharts but for activity page
  // Can load historical data from database here
  updateCharts();
  
  // Update statistics
  updateStatistics();
}

function updateStatistics() {
  if (sensorData.heartRate.length > 0) {
    const avg = sensorData.heartRate.reduce((sum, d) => sum + d.value, 0) / sensorData.heartRate.length;
    document.getElementById('avgHeartRate').textContent = Math.round(avg);
  }
  
  if (sensorData.oxygen.length > 0) {
    const avg = sensorData.oxygen.reduce((sum, d) => sum + d.value, 0) / sensorData.oxygen.length;
    document.getElementById('avgOxygen').textContent = Math.round(avg);
  }
  
  if (sensorData.temperature.length > 0) {
    const avg = sensorData.temperature.reduce((sum, d) => sum + d.value, 0) / sensorData.temperature.length;
    document.getElementById('avgTemperature').textContent = avg.toFixed(1);
  }
  
  const total = Math.max(
    sensorData.heartRate.length,
    sensorData.oxygen.length,
    sensorData.temperature.length,
    sensorData.battery.length
  );
  document.getElementById('totalReadings').textContent = total;
}

// ============================================
// Logs
// ============================================

function addToLog(data, timestamp) {
  const logList = document.getElementById('logList');
  if (!logList) return;
  
  const logItem = document.createElement('div');
  logItem.className = 'log-item';
  
  const values = [];
  if (data.heartRate !== undefined) values.push({ label: 'HR', value: data.heartRate, unit: 'bpm' });
  if (data.oxygen !== undefined) values.push({ label: 'SpO₂', value: data.oxygen, unit: '%' });
  if (data.temperature !== undefined) values.push({ label: 'Temp', value: data.temperature, unit: '°C' });
  if (data.battery !== undefined) values.push({ label: 'Battery', value: data.battery, unit: '%' });
  
  logItem.innerHTML = `
    <div class="log-left">
      <div class="log-indicator"></div>
      <div>
        <div class="log-time">${timestamp.toLocaleTimeString()}</div>
        <div class="log-label">${timestamp.toLocaleDateString()}</div>
      </div>
    </div>
    <div class="log-values">
      ${values.map(v => `
        <div class="log-value-item">
          <div class="log-number">${v.value}</div>
          <div class="log-unit">${v.label} (${v.unit})</div>
        </div>
      `).join('')}
    </div>
  `;
  
  logList.insertBefore(logItem, logList.firstChild);
  
  // Limit log items
  while (logList.children.length > 50) {
    logList.removeChild(logList.lastChild);
  }
}

// ============================================
// Thresholds & Alerts
// ============================================

function checkThresholds(data) {
  const alerts = [];
  
  if (data.heartRate !== undefined) {
    if (data.heartRate > settings.hrHighThreshold) {
      alerts.push({
        type: 'heartRate',
        message: `Critical: Heart rate too high (${data.heartRate} bpm)`,
        severity: 'critical'
      });
    } else if (data.heartRate < settings.hrLowThreshold) {
      alerts.push({
        type: 'heartRate',
        message: `Warning: Heart rate too low (${data.heartRate} bpm)`,
        severity: 'warning'
      });
    }
  }
  
  if (data.oxygen !== undefined && data.oxygen < settings.spLowThreshold) {
    alerts.push({
      type: 'oxygen',
      message: `Critical: Oxygen level too low (${data.oxygen}%)`,
      severity: 'critical'
    });
  }
  
  if (data.temperature !== undefined) {
    if (data.temperature > settings.tempHighThreshold) {
      alerts.push({
        type: 'temperature',
        message: `Critical: High temperature detected (${data.temperature}°C) - Possible fever`,
        severity: 'critical'
      });
    } else if (data.temperature < settings.tempLowThreshold) {
      alerts.push({
        type: 'temperature',
        message: `Warning: Low temperature detected (${data.temperature}°C)`,
        severity: 'warning'
      });
    }
  }
  
  if (data.battery !== undefined && data.battery < settings.batLowThreshold) {
    alerts.push({
      type: 'battery',
      message: `Warning: Battery level low (${data.battery}%)`,
      severity: 'warning'
    });
  }
  
  // Process alerts
  alerts.forEach(alert => {
    if (alert.severity === 'critical') {
      showCriticalAlert(alert.message);
      
      // Voice alert
      if (voiceAlert) {
        voiceAlert.speak(alert.message);
      }
      
      // Emergency mode
      if (emergencyMode && shouldTriggerEmergency(data)) {
        const location = gpsManager?.getCurrentLocation();
        emergencyMode.activate(alert.message, location);
      }
      
      if (settings.emailAlertsEnabled) {
        sendEmailAlert(alert, data);
      }
      
      // Check if emergency call should be triggered
      if (shouldTriggerEmergency(data)) {
        triggerEmergencyCall();
      }
    } else if (alert.severity === 'warning') {
      console.warn(alert.message);
      
      // Voice alert for warnings too
      if (voiceAlert) {
        voiceAlert.speak(alert.message);
      }
      
      if (settings.emailAlertsEnabled) {
        sendEmailAlert(alert, data);
      }
    }
  });
}

function shouldTriggerEmergency(data) {
  // Trigger emergency if multiple critical conditions
  let criticalCount = 0;
  
  if (data.heartRate > settings.hrHighThreshold + 20 || data.heartRate < settings.hrLowThreshold - 10) {
    criticalCount++;
  }
  if (data.oxygen < settings.spLowThreshold - 5) {
    criticalCount++;
  }
  if (data.temperature > settings.tempHighThreshold + 1) {
    criticalCount++;
  }
  
  return criticalCount >= 2;
}

function showCriticalAlert(message) {
  const alertBanner = document.getElementById('criticalAlert');
  const alertMessage = document.getElementById('alertMessage');
  
  if (alertBanner && alertMessage) {
    alertMessage.textContent = message;
    alertBanner.classList.add('show');
    
    // Play alert sound
    playAlertSound();
  }
}

function closeCriticalAlert() {
  const alertBanner = document.getElementById('criticalAlert');
  if (alertBanner) {
    alertBanner.classList.remove('show');
  }
}

function playAlertSound() {
  // Create and play alert sound
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  oscillator.frequency.value = 800;
  oscillator.type = 'sine';
  
  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
  
  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.5);
}

// ============================================
// Email Alerts
// ============================================

async function sendEmailAlert(alert, data) {
  const email = settings.alertEmail || userProfile.emergencyEmail;
  
  if (!email) {
    console.warn('No email address configured for alerts');
    return;
  }
  
  // In a real implementation, this would call a backend API
  // For now, we'll use a mock service or EmailJS
  
  try {
    // Example using EmailJS (requires setup)
    // emailjs.send('service_id', 'template_id', {
    //   to_email: email,
    //   subject: 'Critical Health Alert',
    //   message: alert.message,
    //   values: JSON.stringify(data),
    //   timestamp: new Date().toISOString()
    // });
    
    // Mock implementation - log to console
    console.log('Email Alert:', {
      to: email,
      subject: 'Critical Health Alert Detected',
      message: alert.message,
      data: data,
      timestamp: new Date().toISOString()
    });
    
    // In production, replace with actual email API call
    alert('Email alert would be sent to: ' + email);
  } catch (error) {
    console.error('Failed to send email alert:', error);
  }
}

// ============================================
// Emergency Call
// ============================================

function triggerEmergency() {
  if (confirm('Are you sure you want to trigger an emergency call?')) {
    triggerEmergencyCall();
  }
}

function triggerEmergencyCall() {
  // Show critical alert
  showCriticalAlert('EMERGENCY CALL INITIATED - Contacting emergency services...');
  
  // Play continuous alert sound
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  let emergencySoundInterval;
  
  function playEmergencySound() {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 1000;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  }
  
  // Play sound every second
  emergencySoundInterval = setInterval(playEmergencySound, 1000);
  
  // In a real implementation, this would call an emergency API
  // For now, we'll simulate it
  setTimeout(() => {
    clearInterval(emergencySoundInterval);
    
    // Mock emergency call
    const phoneNumber = userProfile.emergencyPhone || '911';
    
    // Try to initiate call (works on mobile devices)
    if (navigator.userAgent.match(/iPhone|Android/i)) {
      window.location.href = `tel:${phoneNumber}`;
    } else {
      alert(`Emergency call would be made to: ${phoneNumber}\n\nIn production, this would connect to emergency services.`);
    }
    
    // Send emergency email
    if (settings.emailAlertsEnabled) {
      sendEmailAlert({
        type: 'emergency',
        message: 'EMERGENCY CALL TRIGGERED - Immediate medical attention required',
        severity: 'critical'
      }, {
        heartRate: sensorData.heartRate[sensorData.heartRate.length - 1]?.value,
        oxygen: sensorData.oxygen[sensorData.oxygen.length - 1]?.value,
        temperature: sensorData.temperature[sensorData.temperature.length - 1]?.value,
        battery: sensorData.battery[sensorData.battery.length - 1]?.value
      });
    }
  }, 3000);
}

// ============================================
// Database Operations
// ============================================

async function saveToDatabase(data, timestamp) {
  // Fallback to localStorage
  try {
    const stored = JSON.parse(localStorage.getItem('sensorData') || '[]');
    stored.push({ ...data, timestamp: timestamp.toISOString() });
    // Keep only last 1000 records
    if (stored.length > 1000) {
      stored.shift();
    }
    localStorage.setItem('sensorData', JSON.stringify(stored));
  } catch (error) {
    console.error('Failed to save to localStorage:', error);
  }
  
  // Save to Firebase if available
  if (firebaseInitialized && database) {
    try {
      const { push, ref } = await import("https://www.gstatic.com/firebasejs/10.4.0/firebase-database.js");
      const dbRef = ref(database, 'sensorData');
      push(dbRef, {
        ...data,
        timestamp: timestamp.toISOString()
      });
    } catch (error) {
      console.error('Failed to save to database:', error);
    }
  }
}

// ============================================
// Profile Management
// ============================================

function saveProfile() {
  userProfile.name = document.getElementById('profileName').value || 'User Name';
  userProfile.email = document.getElementById('profileEmail').value || '';
  userProfile.emergencyPhone = document.getElementById('emergencyPhone').value || '';
  userProfile.emergencyEmail = document.getElementById('emergencyEmail').value || '';
  
  // Update display
  const nameDisplay = document.getElementById('profileNameDisplay');
  if (nameDisplay) {
    nameDisplay.textContent = userProfile.name;
  }
  
  // Save to localStorage
  localStorage.setItem('userProfile', JSON.stringify(userProfile));
  
  alert('Profile saved successfully!');
}

function loadProfile() {
  try {
    const stored = localStorage.getItem('userProfile');
    if (stored) {
      userProfile = JSON.parse(stored);
      
      // Update UI
      const nameInput = document.getElementById('profileName');
      if (nameInput) nameInput.value = userProfile.name || '';
      
      const nameDisplay = document.getElementById('profileNameDisplay');
      if (nameDisplay) nameDisplay.textContent = userProfile.name || 'User Name';
      
      const emailElement = document.getElementById('profileEmail');
      if (emailElement) emailElement.value = userProfile.email || '';
      
      const phoneElement = document.getElementById('emergencyPhone');
      if (phoneElement) phoneElement.value = userProfile.emergencyPhone || '';
      
      const emergencyEmailElement = document.getElementById('emergencyEmail');
      if (emergencyEmailElement) emergencyEmailElement.value = userProfile.emergencyEmail || '';
    }
  } catch (error) {
    console.error('Failed to load profile:', error);
  }
}

// ============================================
// Settings Management
// ============================================

function saveSettings() {
  settings.hrHighThreshold = parseFloat(document.getElementById('hrHighThreshold').value) || 100;
  settings.hrLowThreshold = parseFloat(document.getElementById('hrLowThreshold').value) || 60;
  settings.spLowThreshold = parseFloat(document.getElementById('spLowThreshold').value) || 95;
  settings.tempHighThreshold = parseFloat(document.getElementById('tempHighThreshold').value) || 37.5;
  settings.tempLowThreshold = parseFloat(document.getElementById('tempLowThreshold').value) || 36.5;
  settings.batLowThreshold = parseFloat(document.getElementById('batLowThreshold').value) || 20;
  settings.refreshInterval = parseFloat(document.getElementById('refreshInterval').value) || 5;
  settings.chartDataPoints = parseInt(document.getElementById('chartDataPoints').value) || 20;
  settings.autoReconnect = document.getElementById('autoReconnect').checked;
  settings.emailAlertsEnabled = document.getElementById('emailAlertsEnabled').checked;
  settings.alertEmail = document.getElementById('alertEmail').value || '';
  
  // Voice alerts
  const voiceEnabled = document.getElementById('voiceAlertsEnabled')?.checked ?? true;
  if (voiceAlert) {
    voiceAlert.setEnabled(voiceEnabled);
  }
  
  // Save to localStorage
  localStorage.setItem('settings', JSON.stringify(settings));
  
  // Restart data update interval with new refresh rate
  if (dataUpdateInterval) {
    startDataUpdateInterval();
  }
  
  alert('Settings saved successfully!');
}

function loadSettings() {
  try {
    const stored = localStorage.getItem('settings');
    if (stored) {
      settings = { ...settings, ...JSON.parse(stored) };
    }
    
    // Update UI
    document.getElementById('hrHighThreshold').value = settings.hrHighThreshold;
    document.getElementById('hrLowThreshold').value = settings.hrLowThreshold;
    document.getElementById('spLowThreshold').value = settings.spLowThreshold;
    document.getElementById('tempHighThreshold').value = settings.tempHighThreshold;
    document.getElementById('tempLowThreshold').value = settings.tempLowThreshold;
    document.getElementById('batLowThreshold').value = settings.batLowThreshold;
    document.getElementById('refreshInterval').value = settings.refreshInterval;
    document.getElementById('chartDataPoints').value = settings.chartDataPoints;
    document.getElementById('autoReconnect').checked = settings.autoReconnect;
    document.getElementById('emailAlertsEnabled').checked = settings.emailAlertsEnabled;
    document.getElementById('alertEmail').value = settings.alertEmail;
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

// ============================================
// Connection Status
// ============================================

function updateConnectionStatus(connected) {
  const dot = document.getElementById('connDot');
  const text = document.getElementById('connText');
  const subtext = document.getElementById('connSubtext');
  
  if (dot) {
    dot.classList.toggle('connected', connected);
  }
  
  if (text) {
    text.textContent = connected ? 'Connected' : 'Disconnected';
  }
  
  if (subtext) {
    subtext.textContent = connected ? 'ESP32 Smart Watch' : 'Waiting for connection';
  }
  
  // Update system status
  if (systemStatus) {
    systemStatus.updateDeviceInfo({
      connected: connected,
      name: connected ? (bluetoothDevice?.name || 'ESP32 Smart Watch') : '--'
    });
  }
}

// ============================================
// Export & Clear Functions
// ============================================

function exportToCSV() {
  const headers = ['Timestamp', 'Heart Rate (bpm)', 'SpO₂ (%)', 'Temperature (°C)', 'Battery (%)'];
  const rows = [];
  
  const maxLength = Math.max(
    sensorData.heartRate.length,
    sensorData.oxygen.length,
    sensorData.temperature.length,
    sensorData.battery.length
  );
  
  for (let i = 0; i < maxLength; i++) {
    const timestamp = sensorData.heartRate[i]?.time || 
                     sensorData.oxygen[i]?.time || 
                     sensorData.temperature[i]?.time || 
                     sensorData.battery[i]?.time || 
                     new Date();
    
    rows.push([
      timestamp.toISOString(),
      sensorData.heartRate[i]?.value || '',
      sensorData.oxygen[i]?.value || '',
      sensorData.temperature[i]?.value || '',
      sensorData.battery[i]?.value || ''
    ]);
  }
  
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `health_data_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
}

function clearLogs() {
  if (confirm('Are you sure you want to clear all logs?')) {
    const logList = document.getElementById('logList');
    if (logList) {
      logList.innerHTML = '';
    }
    
    // Clear data arrays
    sensorData = {
      heartRate: [],
      oxygen: [],
      temperature: [],
      battery: [],
      timestamps: []
    };
    
    // Update charts
    updateCharts();
  }
}

// ============================================
// Modular Classes
// ============================================

// GPS Manager Class
class GPSManager {
  constructor() {
    this.watchId = null;
    this.currentPosition = null;
    this.map = null;
    this.marker = null;
    this.isTracking = false;
    this.mapInitialized = false;
    // Don't init map in constructor - wait for DOM
  }

  initMap() {
    try {
      const mapElement = document.getElementById('map');
      if (mapElement && typeof L !== 'undefined' && !this.mapInitialized) {
        this.map = L.map('map').setView([30.0444, 31.2357], 13); // Default: Cairo, Egypt
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);
        this.mapInitialized = true;
        console.log('Map initialized successfully');
      }
    } catch (error) {
      console.error('Error initializing map:', error);
    }
  }

  startTracking() {
    // Initialize map first if not done
    if (!this.mapInitialized) {
      this.initMap();
    }

    if (!navigator.geolocation) {
      console.warn('Geolocation is not supported');
      this.updateGPSStatus(false);
      // Use mock location for testing
      this.useMockLocation();
      return;
    }

    const options = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    };

    try {
      this.watchId = navigator.geolocation.watchPosition(
        (position) => this.onPositionUpdate(position),
        (error) => this.onPositionError(error),
        options
      );

      this.isTracking = true;
      this.updateGPSStatus(true);
    } catch (error) {
      console.error('Error starting GPS tracking:', error);
      this.useMockLocation();
    }
  }

  useMockLocation() {
    // Mock location for testing (Cairo, Egypt)
    this.currentPosition = {
      lat: 30.0444,
      lng: 31.2357,
      accuracy: 10,
      speed: 0,
      timestamp: new Date()
    };
    this.updateUI();
    this.updateMap();
  }

  stopTracking() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
      this.isTracking = false;
      this.updateGPSStatus(false);
    }
  }

  onPositionUpdate(position) {
    this.currentPosition = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      speed: position.coords.speed || 0,
      timestamp: new Date()
    };

    this.updateUI();
    this.updateMap();
    this.saveLocation();
  }

  onPositionError(error) {
    console.error('GPS Error:', error);
    this.updateGPSStatus(false);
  }

  updateUI() {
    if (!this.currentPosition) return;

    const latEl = document.getElementById('gpsLat');
    const lngEl = document.getElementById('gpsLng');
    const speedEl = document.getElementById('gpsSpeed');
    const accuracyEl = document.getElementById('gpsAccuracy');
    const statusEl = document.getElementById('gpsStatusText');
    const accuracyStatusEl = document.getElementById('gpsAccuracyStatus');
    const lastUpdateEl = document.getElementById('gpsLastUpdate');

    if (latEl) latEl.textContent = this.currentPosition.lat.toFixed(6);
    if (lngEl) lngEl.textContent = this.currentPosition.lng.toFixed(6);
    if (speedEl) speedEl.textContent = (this.currentPosition.speed * 3.6).toFixed(2);
    if (accuracyEl) accuracyEl.textContent = Math.round(this.currentPosition.accuracy);
    if (statusEl) statusEl.textContent = 'Active';
    if (accuracyStatusEl) accuracyStatusEl.textContent = Math.round(this.currentPosition.accuracy);
    if (lastUpdateEl) lastUpdateEl.textContent = this.currentPosition.timestamp.toLocaleTimeString();
  }

  updateMap() {
    if (!this.currentPosition) return;
    
    // Initialize map if not done
    if (!this.mapInitialized) {
      this.initMap();
    }

    if (!this.map || typeof L === 'undefined') return;

    try {
      const { lat, lng } = this.currentPosition;

      if (this.marker) {
        this.marker.setLatLng([lat, lng]);
      } else {
        this.marker = L.marker([lat, lng]).addTo(this.map);
      }

      this.map.setView([lat, lng], 15);
    } catch (error) {
      console.error('Error updating map:', error);
    }
  }

  updateGPSStatus(active) {
    const statusEl = document.getElementById('gpsStatus');
    const dotEl = statusEl?.querySelector('.gps-dot');
    
    if (statusEl) {
      statusEl.querySelector('span').textContent = active ? 'GPS Active' : 'Waiting for GPS...';
    }
    
    if (dotEl) {
      dotEl.classList.toggle('active', active);
    }
  }

  saveLocation() {
    // Save to localStorage for offline mode
    const locations = JSON.parse(localStorage.getItem('gpsLocations') || '[]');
    locations.push(this.currentPosition);
    
    // Keep only last 1000 locations
    if (locations.length > 1000) {
      locations.shift();
    }
    
    localStorage.setItem('gpsLocations', JSON.stringify(locations));
  }

  getCurrentLocation() {
    return this.currentPosition;
  }
}

// Theme Manager Class
class ThemeManager {
  constructor() {
    this.currentTheme = localStorage.getItem('theme') || 'calm-blue';
    this.applyTheme(this.currentTheme);
  }

  applyTheme(themeName) {
    document.body.className = document.body.className.replace(/theme-\w+/g, '');
    document.body.classList.add(`theme-${themeName}`);
    this.currentTheme = themeName;
    localStorage.setItem('theme', themeName);
    
    const selectEl = document.getElementById('themeSelect');
    if (selectEl) {
      selectEl.value = themeName;
    }
  }

  getTheme() {
    return this.currentTheme;
  }
}

// Session Recorder Class
class SessionRecorder {
  constructor() {
    this.isRecording = false;
    this.sessionData = [];
    this.startTime = null;
  }

  start() {
    this.isRecording = true;
    this.startTime = new Date();
    this.sessionData = [];
    this.updateUI();
  }

  stop() {
    this.isRecording = false;
    this.updateUI();
    this.saveSession();
  }

  toggle() {
    if (this.isRecording) {
      this.stop();
    } else {
      this.start();
    }
  }

  addData(data) {
    if (this.isRecording) {
      this.sessionData.push({
        ...data,
        timestamp: new Date(),
        elapsed: Date.now() - this.startTime.getTime()
      });
    }
  }

  exportCSV() {
    if (this.sessionData.length === 0) {
      alert('No session data to export');
      return;
    }

    const headers = ['Timestamp', 'Elapsed (ms)', 'Heart Rate', 'SpO₂', 'Temperature', 'Battery', 'Latitude', 'Longitude'];
    const rows = this.sessionData.map(entry => [
      entry.timestamp.toISOString(),
      entry.elapsed,
      entry.heartRate || '',
      entry.oxygen || '',
      entry.temperature || '',
      entry.battery || '',
      entry.lat || '',
      entry.lng || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `health_session_${this.startTime.toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  updateUI() {
    const btn = document.getElementById('recordBtn');
    const text = document.getElementById('recordText');
    const status = document.getElementById('sessionStatus');
    const exportBtn = document.getElementById('exportSessionBtn');

    if (btn) {
      btn.classList.toggle('recording', this.isRecording);
    }
    if (text) {
      text.textContent = this.isRecording ? 'Stop Recording' : 'Start Recording';
    }
    if (status) {
      status.textContent = this.isRecording 
        ? `Recording... (${this.sessionData.length} readings)`
        : 'Not recording';
    }
    if (exportBtn) {
      exportBtn.disabled = this.sessionData.length === 0;
    }
  }

  saveSession() {
    localStorage.setItem('lastSession', JSON.stringify({
      startTime: this.startTime,
      data: this.sessionData
    }));
  }
}

// Voice Alert Class
class VoiceAlert {
  constructor() {
    this.enabled = localStorage.getItem('voiceAlertsEnabled') !== 'false';
    this.synth = window.speechSynthesis;
  }

  speak(message) {
    if (!this.enabled || !this.synth) return;

    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 0.8;
    this.synth.speak(utterance);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    localStorage.setItem('voiceAlertsEnabled', enabled);
  }
}

// Virtual Watch Class
class VirtualWatch {
  constructor() {
    this.updateTime();
    setInterval(() => this.updateTime(), 1000);
  }

  updateTime() {
    const timeEl = document.getElementById('watchTime');
    if (timeEl) {
      const now = new Date();
      timeEl.textContent = now.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    }
  }

  updateMetrics(data) {
    const hrEl = document.getElementById('watchHR');
    const spEl = document.getElementById('watchSP');
    const tempEl = document.getElementById('watchTemp');

    if (hrEl && data.heartRate !== undefined) {
      hrEl.textContent = Math.round(data.heartRate);
    }
    if (spEl && data.oxygen !== undefined) {
      spEl.textContent = Math.round(data.oxygen);
    }
    if (tempEl && data.temperature !== undefined) {
      tempEl.textContent = parseFloat(data.temperature).toFixed(1);
    }
  }
}

// System Status Class
class SystemStatus {
  constructor() {
    this.fps = 0;
    this.lastFrameTime = Date.now();
    this.packetLoss = 0;
    this.totalPackets = 0;
    this.missedPackets = 0;
    this.startFPSMonitoring();
  }

  startFPSMonitoring() {
    let lastTime = performance.now();
    let frames = 0;

    const measureFPS = () => {
      frames++;
      const currentTime = performance.now();
      
      if (currentTime >= lastTime + 1000) {
        this.fps = frames;
        frames = 0;
        lastTime = currentTime;
        this.updateFPS();
      }
      
      requestAnimationFrame(measureFPS);
    };
    
    measureFPS();
  }

  updateFPS() {
    const fpsEl = document.getElementById('fpsCounter');
    if (fpsEl) {
      fpsEl.textContent = this.fps;
    }
  }

  recordPacket(success) {
    this.totalPackets++;
    if (!success) {
      this.missedPackets++;
    }
    this.packetLoss = (this.missedPackets / this.totalPackets) * 100;
    
    const lossEl = document.getElementById('packetLoss');
    if (lossEl) {
      lossEl.textContent = this.packetLoss.toFixed(2);
    }
  }

  updateDeviceInfo(deviceInfo) {
    const nameEl = document.getElementById('deviceName');
    const firmwareEl = document.getElementById('firmwareVersion');
    const batteryEl = document.getElementById('deviceBattery');
    const uptimeEl = document.getElementById('deviceUptime');
    const tempEl = document.getElementById('deviceTemperature');
    const rssiEl = document.getElementById('bleRSSI');
    const syncEl = document.getElementById('lastSyncTime');
    const connEl = document.getElementById('connectionStatus');

    if (nameEl && deviceInfo.name) nameEl.textContent = deviceInfo.name;
    if (firmwareEl && deviceInfo.firmware) firmwareEl.textContent = deviceInfo.firmware;
    if (batteryEl && deviceInfo.battery !== undefined) batteryEl.textContent = deviceInfo.battery;
    if (uptimeEl && deviceInfo.uptime) uptimeEl.textContent = deviceInfo.uptime;
    if (tempEl && deviceInfo.temperature !== undefined) tempEl.textContent = deviceInfo.temperature;
    if (rssiEl && deviceInfo.rssi !== undefined) rssiEl.textContent = deviceInfo.rssi;
    if (syncEl) syncEl.textContent = new Date().toLocaleTimeString();
    if (connEl) connEl.textContent = deviceInfo.connected ? 'Connected' : 'Disconnected';
  }
}

// Emergency Mode Class
class EmergencyMode {
  constructor() {
    this.isActive = false;
  }

  activate(message, location) {
    this.isActive = true;
    document.body.classList.add('emergency-mode');
    
    const overlay = document.getElementById('emergencyMode');
    const messageEl = document.getElementById('emergencyMessage');
    
    if (overlay) {
      overlay.classList.add('show');
    }
    if (messageEl) {
      messageEl.textContent = message;
    }

    // Send browser notification
    this.sendNotification(message, location);
  }

  deactivate() {
    this.isActive = false;
    document.body.classList.remove('emergency-mode');
    
    const overlay = document.getElementById('emergencyMode');
    if (overlay) {
      overlay.classList.remove('show');
    }
  }

  sendNotification(message, location) {
    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification('Emergency Alert', {
        body: message,
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        tag: 'emergency',
        requireInteraction: true,
        data: { location }
      });

      notification.onclick = () => {
        if (location) {
          window.open(`https://www.google.com/maps?q=${location.lat},${location.lng}`, '_blank');
        }
        notification.close();
      };
    }
  }
}

// Initialize managers
let gpsManager = null;
let themeManager = null;
let sessionRecorder = null;
let voiceAlert = null;
let virtualWatch = null;
let systemStatus = null;
let emergencyMode = null;

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing app...');
  
  try {
    // Initialize charts
    initializeCharts();
    
    // Initialize managers
    gpsManager = new GPSManager();
    themeManager = new ThemeManager();
    sessionRecorder = new SessionRecorder();
    voiceAlert = new VoiceAlert();
    virtualWatch = new VirtualWatch();
    systemStatus = new SystemStatus();
    emergencyMode = new EmergencyMode();
    
    // Initialize map after a short delay to ensure Leaflet is loaded
    setTimeout(() => {
      if (gpsManager) {
        gpsManager.initMap();
        gpsManager.startTracking();
      }
    }, 500);
    
    // Start with mock data for testing
    startMockData();
  
  // Load saved data
  loadProfile();
  loadSettings();
  loadAvatar();
  
  // Set up event listeners
  document.getElementById('exportBtn')?.addEventListener('click', exportToCSV);
  document.getElementById('clearBtn')?.addEventListener('click', clearLogs);
  
  // Theme selector
  const themeSelect = document.getElementById('themeSelect');
  if (themeSelect) {
    themeSelect.addEventListener('change', (e) => {
      themeManager.applyTheme(e.target.value);
    });
  }
  
  // Avatar upload
  const avatarUpload = document.getElementById('avatarUpload');
  if (avatarUpload) {
    avatarUpload.addEventListener('change', handleAvatarUpload);
  }
  
  // Voice alerts toggle
  const voiceAlertsEnabled = document.getElementById('voiceAlertsEnabled');
  if (voiceAlertsEnabled) {
    voiceAlertsEnabled.addEventListener('change', (e) => {
      voiceAlert.setEnabled(e.target.checked);
    });
  }
  
  // Update profile name display in real-time
  const profileNameInput = document.getElementById('profileName');
  const profileNameDisplay = document.getElementById('profileNameDisplay');
  if (profileNameInput && profileNameDisplay) {
    profileNameInput.addEventListener('input', (e) => {
      profileNameDisplay.textContent = e.target.value || 'User Name';
    });
  }
  
  // Request notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  
  // Register service worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
      .then(reg => console.log('Service Worker registered'))
      .catch(err => console.error('Service Worker registration failed:', err));
  }
  
    // Start data update interval (for simulation if not connected)
    startDataUpdateInterval();
    
    // Update connection status
    updateConnectionStatus(false);
    
    console.log('Smart-Watch Health Monitor initialized');
    console.log('Created by: OMAR GOUDA');
    console.log('Team: Egyptian Chinese University Team (ECU)');
    
    // Show welcome message
    setTimeout(() => {
      console.log('✅ التطبيق جاهز للاستخدام / App is ready!');
      console.log('📱 يمكنك الآن التنقل بين الصفحات / You can now navigate between pages');
      console.log('💡 البيانات التجريبية تعمل تلقائياً / Mock data is running automatically');
    }, 1000);
    
  } catch (error) {
    console.error('Error during initialization:', error);
    alert('حدث خطأ أثناء تحميل التطبيق. يرجى تحديث الصفحة.\n\nError loading app. Please refresh the page.');
  }
});

// Start mock data for testing
function startMockData() {
  // Generate initial mock data
  const mockData = {
    heartRate: Math.floor(Math.random() * 40) + 60,
    oxygen: Math.floor(Math.random() * 5) + 95,
    temperature: (Math.random() * 1.5 + 36.5).toFixed(1),
    battery: Math.floor(Math.random() * 30) + 70
  };
  
  // Process initial data
  setTimeout(() => {
    processSensorData(mockData);
  }, 1000);
}

// Additional helper functions
function toggleRecording() {
  if (sessionRecorder) {
    sessionRecorder.toggle();
  }
}

function exportSession() {
  if (sessionRecorder) {
    sessionRecorder.exportCSV();
  }
}

function handleAvatarUpload(event) {
  const file = event.target.files[0];
  if (file && file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const avatarImg = document.getElementById('avatarImage');
      const avatarIcon = document.getElementById('avatarIcon');
      
      if (avatarImg) {
        avatarImg.src = e.target.result;
        avatarImg.style.display = 'block';
      }
      if (avatarIcon) {
        avatarIcon.style.display = 'none';
      }
      
      // Save to localStorage
      localStorage.setItem('avatar', e.target.result);
    };
    reader.readAsDataURL(file);
  }
}

function sendLocationAgain() {
  const location = gpsManager?.getCurrentLocation();
  if (location) {
    const message = `Emergency location: ${location.lat}, ${location.lng}`;
    if (voiceAlert) {
      voiceAlert.speak(message);
    }
    if (emergencyMode) {
      emergencyMode.sendNotification('Location sent', location);
    }
  }
}

function closeEmergencyMode() {
  if (emergencyMode) {
    emergencyMode.deactivate();
  }
}

// Load avatar on page load
function loadAvatar() {
  const savedAvatar = localStorage.getItem('avatar');
  if (savedAvatar) {
    const avatarImg = document.getElementById('avatarImage');
    const avatarIcon = document.getElementById('avatarIcon');
    
    if (avatarImg) {
      avatarImg.src = savedAvatar;
      avatarImg.style.display = 'block';
    }
    if (avatarIcon) {
      avatarIcon.style.display = 'none';
    }
  }
}

// Make functions globally available (must be before DOMContentLoaded)
window.connectBluetooth = connectBluetooth;
window.disconnectBluetooth = disconnectBluetooth;
window.triggerEmergency = triggerEmergency;
window.showPage = showPage;
window.saveProfile = saveProfile;
window.saveSettings = saveSettings;
window.closeCriticalAlert = closeCriticalAlert;
window.toggleRecording = toggleRecording;
window.exportSession = exportSession;
window.sendLocationAgain = sendLocationAgain;
window.closeEmergencyMode = closeEmergencyMode;

// Ensure showPage is available immediately
if (typeof showPage === 'function') {
  console.log('showPage function is ready');
} else {
  console.error('showPage function not found!');
}

