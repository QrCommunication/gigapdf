#!/bin/bash
# =============================================================================
# GigaPDF Local Deploy Script
# Run this from your local machine to deploy to production
# Usage: ./deploy/push-deploy.sh
# =============================================================================

set -e

echo "=========================================="
echo "  GigaPDF - Push to Production"
echo "=========================================="

# Configuration
REMOTE_USER="root"
REMOTE_HOST="51.15.197.29"
REMOTE_NAME="production"
SSH_KEY="$HOME/.ssh/gigapdf_deploy"

# Check if SSH key exists
if [ ! -f "$SSH_KEY" ]; then
    echo "Error: SSH key not found at $SSH_KEY"
    echo "Generate one with: ssh-keygen -t ed25519 -C 'gigapdf-deploy' -f $SSH_KEY"
    exit 1
fi

# Check if remote is configured
if ! git remote | grep -q "$REMOTE_NAME"; then
    echo "Adding production remote..."
    git remote add $REMOTE_NAME $REMOTE_USER@$REMOTE_HOST:/opt/gigapdf-repo.git
fi

# Get current branch
CURRENT_BRANCH=$(git branch --show-current)

echo ""
echo "Deploying branch: $CURRENT_BRANCH"
echo "To: $REMOTE_USER@$REMOTE_HOST"
echo ""

# Confirm deployment
read -p "Continue with deployment? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 0
fi

# Push to production
echo ""
echo "Pushing to production..."
GIT_SSH_COMMAND="ssh -i $SSH_KEY" git push $REMOTE_NAME $CURRENT_BRANCH:main

echo ""
echo "=========================================="
echo "  Deployment initiated!"
echo "=========================================="
echo ""
echo "Monitor deployment logs:"
echo "  ssh -i $SSH_KEY $REMOTE_USER@$REMOTE_HOST 'tail -f /var/log/gigapdf/*.log'"
echo ""
echo "Check service status:"
echo "  ssh -i $SSH_KEY $REMOTE_USER@$REMOTE_HOST 'systemctl status gigapdf-*'"
echo ""
