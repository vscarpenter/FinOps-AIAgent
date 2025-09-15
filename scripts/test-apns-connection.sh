#!/bin/bash

# AWS Spend Monitor - APNS Connection Testing Script
# This script tests connectivity to Apple Push Notification Service

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_ROOT/.ios-config"

# APNS endpoints
APNS_SANDBOX="api.sandbox.push.apple.com"
APNS_PRODUCTION="api.push.apple.com"
APNS_PORT="443"

# Functions
print_header() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE} APNS Connection Testing${NC}"
    echo -e "${BLUE}================================${NC}"
    echo
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

check_prerequisites() {
    print_info "Checking prerequisites..."
    
    # Check curl
    if ! command -v curl &> /dev/null; then
        print_error "curl is not installed"
        exit 1
    fi
    
    # Check openssl
    if ! command -v openssl &> /dev/null; then
        print_error "openssl is not installed"
        exit 1
    fi
    
    # Check nc (netcat) for port testing
    if ! command -v nc &> /dev/null; then
        print_warning "netcat (nc) is not installed - some tests will be skipped"
    fi
    
    print_success "Prerequisites check passed"
}

load_configuration() {
    if [[ -f "$CONFIG_FILE" ]]; then
        print_info "Loading configuration from $CONFIG_FILE"
        source "$CONFIG_FILE"
    else
        print_warning "Configuration file not found: $CONFIG_FILE"
    fi
}

test_basic_connectivity() {
    print_info "Testing basic network connectivity..."
    
    # Test internet connectivity
    if ping -c 1 8.8.8.8 &> /dev/null; then
        print_success "Internet connectivity available"
    else
        print_error "No internet connectivity"
        return 1
    fi
    
    # Test DNS resolution for APNS endpoints
    if nslookup "$APNS_SANDBOX" &> /dev/null; then
        print_success "DNS resolution for APNS sandbox: $APNS_SANDBOX"
    else
        print_error "Cannot resolve APNS sandbox: $APNS_SANDBOX"
    fi
    
    if nslookup "$APNS_PRODUCTION" &> /dev/null; then
        print_success "DNS resolution for APNS production: $APNS_PRODUCTION"
    else
        print_error "Cannot resolve APNS production: $APNS_PRODUCTION"
    fi
}

test_port_connectivity() {
    print_info "Testing port connectivity..."
    
    if command -v nc &> /dev/null; then
        # Test APNS sandbox port
        if timeout 5 nc -z "$APNS_SANDBOX" "$APNS_PORT" 2>/dev/null; then
            print_success "Port $APNS_PORT is open on $APNS_SANDBOX"
        else
            print_error "Port $APNS_PORT is not accessible on $APNS_SANDBOX"
        fi
        
        # Test APNS production port
        if timeout 5 nc -z "$APNS_PRODUCTION" "$APNS_PORT" 2>/dev/null; then
            print_success "Port $APNS_PORT is open on $APNS_PRODUCTION"
        else
            print_error "Port $APNS_PORT is not accessible on $APNS_PRODUCTION"
        fi
    else
        print_warning "Skipping port connectivity tests (netcat not available)"
    fi
}

test_ssl_connectivity() {
    print_info "Testing SSL/TLS connectivity..."
    
    # Test APNS sandbox SSL
    print_info "Testing APNS sandbox SSL handshake..."
    if timeout 10 openssl s_client -connect "$APNS_SANDBOX:$APNS_PORT" -servername "$APNS_SANDBOX" </dev/null 2>/dev/null | grep -q "Verify return code: 0"; then
        print_success "SSL handshake successful with APNS sandbox"
    else
        print_warning "SSL handshake issues with APNS sandbox (may still work)"
    fi
    
    # Test APNS production SSL
    print_info "Testing APNS production SSL handshake..."
    if timeout 10 openssl s_client -connect "$APNS_PRODUCTION:$APNS_PORT" -servername "$APNS_PRODUCTION" </dev/null 2>/dev/null | grep -q "Verify return code: 0"; then
        print_success "SSL handshake successful with APNS production"
    else
        print_warning "SSL handshake issues with APNS production (may still work)"
    fi
}

test_http2_support() {
    print_info "Testing HTTP/2 support..."
    
    # APNS requires HTTP/2, so we test if curl supports it
    if curl --version | grep -q "HTTP2"; then
        print_success "curl supports HTTP/2"
        
        # Test HTTP/2 connection to APNS sandbox
        if curl -s --http2 --connect-timeout 10 "https://$APNS_SANDBOX" -o /dev/null 2>/dev/null; then
            print_success "HTTP/2 connection successful to APNS sandbox"
        else
            print_warning "HTTP/2 connection issues with APNS sandbox"
        fi
        
        # Test HTTP/2 connection to APNS production
        if curl -s --http2 --connect-timeout 10 "https://$APNS_PRODUCTION" -o /dev/null 2>/dev/null; then
            print_success "HTTP/2 connection successful to APNS production"
        else
            print_warning "HTTP/2 connection issues with APNS production"
        fi
    else
        print_error "curl does not support HTTP/2 - APNS requires HTTP/2"
    fi
}

test_certificate_connectivity() {
    print_info "Testing certificate-based connectivity..."
    
    if [[ -z "$CERT_PATH" || -z "$KEY_PATH" ]]; then
        print_warning "Certificate paths not configured - skipping certificate tests"
        return 0
    fi
    
    if [[ ! -f "$CERT_PATH" ]]; then
        print_error "Certificate file not found: $CERT_PATH"
        return 1
    fi
    
    if [[ ! -f "$KEY_PATH" ]]; then
        print_error "Private key file not found: $KEY_PATH"
        return 1
    fi
    
    # Test certificate format
    if openssl x509 -in "$CERT_PATH" -noout -text &> /dev/null; then
        print_success "Certificate file format is valid"
    else
        print_error "Invalid certificate file format"
        return 1
    fi
    
    # Test private key format
    if openssl rsa -in "$KEY_PATH" -check -noout &> /dev/null; then
        print_success "Private key file format is valid"
    else
        print_error "Invalid private key file format"
        return 1
    fi
    
    # Test certificate and key match
    CERT_MODULUS=$(openssl x509 -noout -modulus -in "$CERT_PATH" | openssl md5)
    KEY_MODULUS=$(openssl rsa -noout -modulus -in "$KEY_PATH" | openssl md5)
    
    if [[ "$CERT_MODULUS" == "$KEY_MODULUS" ]]; then
        print_success "Certificate and private key match"
    else
        print_error "Certificate and private key do not match"
        return 1
    fi
    
    # Test certificate expiration
    EXPIRY_DATE=$(openssl x509 -in "$CERT_PATH" -noout -enddate | cut -d= -f2)
    EXPIRY_TIMESTAMP=$(date -d "$EXPIRY_DATE" +%s 2>/dev/null || date -j -f "%b %d %H:%M:%S %Y %Z" "$EXPIRY_DATE" +%s 2>/dev/null)
    CURRENT_TIMESTAMP=$(date +%s)
    
    if [[ $EXPIRY_TIMESTAMP -gt $CURRENT_TIMESTAMP ]]; then
        DAYS_UNTIL_EXPIRY=$(( (EXPIRY_TIMESTAMP - CURRENT_TIMESTAMP) / 86400 ))
        print_success "Certificate is valid (expires in $DAYS_UNTIL_EXPIRY days)"
        
        if [[ $DAYS_UNTIL_EXPIRY -lt 30 ]]; then
            print_warning "Certificate expires soon: $EXPIRY_DATE"
        fi
    else
        print_error "Certificate has expired: $EXPIRY_DATE"
        return 1
    fi
    
    # Test actual APNS connection with certificate (sandbox)
    print_info "Testing authenticated connection to APNS sandbox..."
    APNS_RESPONSE=$(curl -s --http2 \
        --cert "$CERT_PATH" \
        --key "$KEY_PATH" \
        --connect-timeout 10 \
        -H "apns-topic: $BUNDLE_ID" \
        -H "apns-push-type: alert" \
        -d '{"aps":{"alert":"test"}}' \
        "https://$APNS_SANDBOX/3/device/0000000000000000000000000000000000000000000000000000000000000000" \
        -w "%{http_code}" 2>/dev/null)
    
    # We expect a 400 (BadDeviceToken) response, which means the connection worked
    if [[ "$APNS_RESPONSE" == "400" ]]; then
        print_success "Authenticated connection to APNS sandbox successful"
    elif [[ "$APNS_RESPONSE" == "403" ]]; then
        print_error "APNS sandbox rejected certificate (403 Forbidden)"
    else
        print_warning "Unexpected response from APNS sandbox: $APNS_RESPONSE"
    fi
}

test_firewall_restrictions() {
    print_info "Testing for firewall restrictions..."
    
    # Test if we can reach APNS endpoints on different ports
    COMMON_BLOCKED_PORTS=(80 8080 3128 8888)
    
    for port in "${COMMON_BLOCKED_PORTS[@]}"; do
        if timeout 3 nc -z "$APNS_SANDBOX" "$port" 2>/dev/null; then
            print_warning "Unexpected open port $port on $APNS_SANDBOX (possible proxy)"
        fi
    done
    
    # Test if HTTP (non-HTTPS) requests are blocked or redirected
    HTTP_RESPONSE=$(curl -s --connect-timeout 5 "http://$APNS_SANDBOX" -w "%{http_code}" -o /dev/null 2>/dev/null || echo "000")
    
    if [[ "$HTTP_RESPONSE" == "000" ]]; then
        print_success "HTTP requests properly blocked (HTTPS-only as expected)"
    else
        print_warning "HTTP requests not blocked (response: $HTTP_RESPONSE)"
    fi
}

generate_connectivity_report() {
    echo
    print_info "Connectivity Test Summary"
    echo "========================="
    
    # Basic network info
    print_info "Network Information:"
    echo "  Local IP: $(curl -s ifconfig.me 2>/dev/null || echo "Unable to determine")"
    echo "  DNS Server: $(cat /etc/resolv.conf | grep nameserver | head -1 | awk '{print $2}' 2>/dev/null || echo "Unable to determine")"
    
    # APNS endpoint info
    print_info "APNS Endpoints:"
    echo "  Sandbox: $APNS_SANDBOX:$APNS_PORT"
    echo "  Production: $APNS_PRODUCTION:$APNS_PORT"
    
    # Certificate info (if available)
    if [[ -n "$CERT_PATH" && -f "$CERT_PATH" ]]; then
        print_info "Certificate Information:"
        CERT_SUBJECT=$(openssl x509 -in "$CERT_PATH" -noout -subject | sed 's/subject=//')
        CERT_ISSUER=$(openssl x509 -in "$CERT_PATH" -noout -issuer | sed 's/issuer=//')
        CERT_EXPIRY=$(openssl x509 -in "$CERT_PATH" -noout -enddate | cut -d= -f2)
        
        echo "  Subject: $CERT_SUBJECT"
        echo "  Issuer: $CERT_ISSUER"
        echo "  Expires: $CERT_EXPIRY"
    fi
    
    echo
    print_info "Recommendations:"
    echo "1. Ensure your firewall allows HTTPS (443) to *.push.apple.com"
    echo "2. If behind a corporate firewall, whitelist APNS endpoints"
    echo "3. Verify certificates are valid and not expired"
    echo "4. Test with both sandbox and production environments"
}

show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo
    echo "Options:"
    echo "  -h, --help              Show this help message"
    echo "  -c, --config FILE       Use specific config file"
    echo "  --cert-path PATH        Path to certificate file"
    echo "  --key-path PATH         Path to private key file"
    echo "  --bundle-id ID          Bundle ID for testing"
    echo "  --sandbox-only          Test only sandbox environment"
    echo "  --production-only       Test only production environment"
    echo "  --skip-auth             Skip certificate authentication tests"
    echo "  --verbose               Show detailed output"
    echo
    echo "Examples:"
    echo "  $0                                    # Full connectivity test"
    echo "  $0 --sandbox-only                    # Test only sandbox"
    echo "  $0 --cert-path cert.pem --key-path key.pem  # Test with specific certificates"
}

# Parse command line arguments
SANDBOX_ONLY=false
PRODUCTION_ONLY=false
SKIP_AUTH=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -c|--config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        --cert-path)
            CERT_PATH="$2"
            shift 2
            ;;
        --key-path)
            KEY_PATH="$2"
            shift 2
            ;;
        --bundle-id)
            BUNDLE_ID="$2"
            shift 2
            ;;
        --sandbox-only)
            SANDBOX_ONLY=true
            shift
            ;;
        --production-only)
            PRODUCTION_ONLY=true
            shift
            ;;
        --skip-auth)
            SKIP_AUTH=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        *)
            print_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Main execution
main() {
    print_header
    
    check_prerequisites
    load_configuration
    
    test_basic_connectivity
    test_port_connectivity
    test_ssl_connectivity
    test_http2_support
    test_firewall_restrictions
    
    if [[ "$SKIP_AUTH" != "true" ]]; then
        test_certificate_connectivity
    fi
    
    generate_connectivity_report
    
    echo
    print_success "APNS connectivity testing completed!"
    print_info "If you encountered issues, check the troubleshooting guide in docs/IOS-SETUP.md"
}

# Run main function
main "$@"