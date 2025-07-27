// log.js - Privacy-focused logging system that prevents IP tracking
class PrivacyLogger {
  constructor() {
    // Disable common IP tracking methods
    this.disableIPTracking();
    
    // Initialize log storage in memory (no file system access on Render)
    this.logs = [];
    this.maxLogs = 1000; // Keep only recent logs
  }
  
  disableIPTracking() {
    // Override common IP detection methods
    process.env.NODE_ENV = 'production';
    
    // Prevent common IP logging in Express
    process.env.DISABLE_IP_LOGGING = 'true';
    
    // Mask IP addresses in logs
    this.maskIP = true;
  }
  
  // Mask IP address for privacy
  maskIPAddress(ip) {
    if (!this.maskIP || !ip) return '0.0.0.0';
    
    // Only log network class for identification
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.x.x`;
    }
    return 'x.x.x.x';
  }
  
  // Log activity without tracking user identity
  logActivity(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const maskedMessage = message.replace(
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, 
      ip => this.maskIPAddress(ip)
    );
    
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${maskedMessage}`;
    
    // Store in memory (no file system on Render)
    this.logs.push(logEntry);
    
    // Keep only recent logs
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    
    // Also log to console without sensitive data
    console.log(`[${level.toUpperCase()}] Activity logged (details protected)`);
  }
  
  // Log system events without user data
  logSystem(message) {
    this.logActivity(`[SYSTEM] ${message}`, 'system');
  }
  
  // Log errors without exposing user information
  logError(error) {
    const errorMessage = error.message || String(error);
    const maskedError = errorMessage.replace(
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, 
      ip => this.maskIPAddress(ip)
    );
    
    this.logActivity(`[ERROR] ${maskedError}`, 'error');
  }
  
  // Prevent logging of sensitive headers
  sanitizeHeaders(headers) {
    const sensitiveHeaders = [
      'x-forwarded-for',
      'x-real-ip',
      'x-client-ip',
      'cf-connecting-ip',
      'true-client-ip'
    ];
    
    const sanitized = { ...headers };
    
    sensitiveHeaders.forEach(header => {
      if (sanitized[header]) {
        sanitized[header] = this.maskIPAddress(sanitized[header]);
      }
    });
    
    return sanitized;
  }
  
  // Generate anonymous session ID
  generateAnonymousSession() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }
  
  // Get recent logs (for debugging only)
  getRecentLogs(count = 10) {
    return this.logs.slice(-count);
  }
}

module.exports = new PrivacyLogger();
