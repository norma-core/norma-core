import React, { useEffect, useRef, useMemo } from 'react';
import { st3215 } from '@/api/proto';
import { getMotorPosition } from './motor-parser';
import { useTheme } from '@/hooks/useTheme';
import { getCanvasThemeColors } from '@/utils/theme-colors';

interface BusStatusCanvasProps {
  bus: st3215.InferenceState.IBusState;
  size?: number;
}

const BusStatusCanvas: React.FC<BusStatusCanvasProps> = ({ bus, size = 64 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  // Calculate percentage from motor position and range
  const calculatePercentage = (position: number, min: number, max: number): number => {
    const MAX_ANGLE_STEP = 4095;
    if (min > max) { // Counter-arc
      const totalRange = (MAX_ANGLE_STEP - min) + max;
      if (totalRange === 0) return 0;
      if (position >= min) {
        return ((position - min) / totalRange) * 100;
      } else {
        return ((MAX_ANGLE_STEP - min + position) / totalRange) * 100;
      }
    }
    if (max === min) return 0;
    return ((position - min) / (max - min)) * 100;
  };

  // Memoize motor data to prevent unnecessary re-renders
  const motorData = useMemo(() => {
    // Check if we have motors
    if (!bus.motors || bus.motors.length === 0) return null;

    // Find motors by ID
    const motor1 = bus.motors.find(m => m.id === 1); // Motor ID 1 for color
    const motor2 = bus.motors.find(m => m.id === 2); // Motor ID 2 for position and angle
    const motor3 = bus.motors.find(m => m.id === 3); // Motor ID 3 for second line angle
    const motor4 = bus.motors.find(m => m.id === 4); // Motor ID 4 for third line angle
    const motor6 = bus.motors.find(m => m.id === 6); // Motor ID 6 for circle fill percentage

    if (!motor1 || !motor2 || !motor1.state || !motor2.state) return null;

    // Calculate positions and percentages
    const motor1Position = getMotorPosition(motor1.state);
    const motor1Percentage = calculatePercentage(
      motor1Position,
      motor1.rangeMin || 0,
      motor1.rangeMax || 4095
    );

    const motor2Position = getMotorPosition(motor2.state);
    const motor2Percentage = calculatePercentage(
      motor2Position,
      motor2.rangeMin || 0,
      motor2.rangeMax || 4095
    );

    // Calculate motor 3 percentage if available
    let motor3Percentage = 0;
    if (motor3 && motor3.state) {
      const motor3Position = getMotorPosition(motor3.state);
      motor3Percentage = calculatePercentage(
        motor3Position,
        motor3.rangeMin || 0,
        motor3.rangeMax || 4095
      );
    }

    // Calculate motor 4 percentage if available
    let motor4Percentage = 0;
    if (motor4 && motor4.state) {
      const motor4Position = getMotorPosition(motor4.state);
      motor4Percentage = calculatePercentage(
        motor4Position,
        motor4.rangeMin || 0,
        motor4.rangeMax || 4095
      );
    }

    // Calculate motor 6 percentage if available
    let motor6Percentage = 0;
    if (motor6 && motor6.state) {
      const motor6Position = getMotorPosition(motor6.state);
      motor6Percentage = calculatePercentage(
        motor6Position,
        motor6.rangeMin || 0,
        motor6.rangeMax || 4095
      );
    }

    return {
      motor1Position,
      motor1Percentage,
      motor2Position,
      motor2Percentage,
      motor3Percentage,
      motor4Percentage,
      motor6Percentage
    };
  }, [
    // Create a string representation of motor states to detect changes
    bus.motors?.map(m => `${m.id}:${m.state?.toString()}:${m.rangeMin}:${m.rangeMax}`).join(',')
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to match the display size
    canvas.width = size;
    canvas.height = size;

    const { canvasFill, canvasBlue, canvasRed, canvasWhite } = getCanvasThemeColors(theme);

    const parseHex = (hex: string) => {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 0, b: 0 };
    };
    const blueRgb = parseHex(canvasBlue);
    const redRgb = parseHex(canvasRed);
    const whiteRgb = parseHex(canvasWhite);

    ctx.fillStyle = canvasFill;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Check if we have motor data
    if (!motorData) return;

    const { motor1Percentage, motor2Percentage, motor3Percentage, motor4Percentage, motor6Percentage } = motorData;

    // Calculate gradient color based on motor1Percentage
    // 0-45%: Blue to White transition
    // 45-55%: White
    // 55-100%: White to Red transition
    let lineColor: string;
    if (motor1Percentage < 45) {
      const t = motor1Percentage / 45;
      const r = Math.round(blueRgb.r + (whiteRgb.r - blueRgb.r) * t);
      const g = Math.round(blueRgb.g + (whiteRgb.g - blueRgb.g) * t);
      const b = Math.round(blueRgb.b + (whiteRgb.b - blueRgb.b) * t);
      lineColor = `rgb(${r}, ${g}, ${b})`;
    } else if (motor1Percentage <= 55) {
      lineColor = canvasWhite;
    } else {
      const t = (motor1Percentage - 55) / 45;
      const r = whiteRgb.r;
      const g = Math.round(whiteRgb.g - (whiteRgb.g - redRgb.g) * t);
      const b = Math.round(whiteRgb.b - (whiteRgb.b - redRgb.b) * t);
      lineColor = `rgb(${r}, ${g}, ${b})`;
    }

    // Calculate angles and line lengths first
    const arcRadius = 4; // Radius of the circles at start and end points
    const startY = size - arcRadius; // Bottom of canvas minus arc radius
    
    // Calculate angle from motor2 percentage (0-100 maps to 0-180 degrees)
    // 0% = 0 degrees (left), 50% = 90 degrees (up), 100% = 180 degrees (right)
    const angleDegrees = (motor2Percentage / 100) * 180;
    const angleRadians = (angleDegrees * Math.PI) / 180;

    // Calculate line length (36% of canvas width)
    const lineLength = size * 0.36;
    
    // Calculate angles for second and third lines
    const relativeAngleDegrees = (motor3Percentage / 100) * 180;
    const relativeAngleRadians = (relativeAngleDegrees * Math.PI) / 180;
    const secondLineAngleRadians = angleRadians + relativeAngleRadians;
    
    const thirdRelativeAngleDegrees = 90 + (motor4Percentage / 100) * 180;
    const thirdRelativeAngleRadians = (thirdRelativeAngleDegrees * Math.PI) / 180;
    const thirdLineAngleRadians = secondLineAngleRadians + thirdRelativeAngleRadians;
    
    // Calculate line length for third line (22% of canvas width)
    const thirdLineLength = size * 0.22;
    
    // Function to calculate thirdEndX given a startX
    const calculateThirdEndX = (testStartX: number): number => {
      const testEndX = testStartX - Math.cos(angleRadians) * lineLength;
      
      const testSecondEndX = testEndX - Math.cos(secondLineAngleRadians) * lineLength;
      
      const testThirdEndX = testSecondEndX + Math.cos(thirdLineAngleRadians) * thirdLineLength;
      
      return testThirdEndX;
    };
    
    // Try different startX positions and choose the one that keeps both first and last points on canvas
    const margin = arcRadius + 2; // Add some margin to keep circles fully visible
    let startX: number = size / 2; // Default to middle
    
    // Test many positions across the canvas width
    const step = size * 0.02; // Test every 2% of canvas width
    let validPositions: { x: number, score: number }[] = [];
    
    for (let testStartX = margin; testStartX <= size - margin; testStartX += step) {
      const testThirdEndX = calculateThirdEndX(testStartX);
      
      // Check if both points are within canvas bounds
      if (testStartX >= margin && testStartX <= size - margin &&
          testThirdEndX >= margin && testThirdEndX <= size - margin) {
        // Calculate how much space is used on each side
        const leftSpace = Math.min(testStartX, testThirdEndX);
        const rightSpace = size - Math.max(testStartX, testThirdEndX);
        
        // Score based on:
        // 1. How much margin we have (more margin = better)
        // 2. Balance between left and right margins
        const minMargin = Math.min(leftSpace, rightSpace);
        const marginBalance = Math.abs(leftSpace - rightSpace);
        
        // Higher score is better
        // Prioritize having good margins, then balance
        const score = minMargin * 100 - marginBalance;
        
        validPositions.push({ x: testStartX, score });
      }
    }
    
    // If we found valid positions, use the best one
    if (validPositions.length > 0) {
      // Sort by score (descending) and pick the best
      validPositions.sort((a, b) => b.score - a.score);
      startX = validPositions[0].x;
    } else {
      // Fallback: if no valid position found, try to at least keep startX in bounds
      // and accept that thirdEndX might go out of bounds
      if (motor2Percentage < 33) {
        startX = size - margin; // Start from right if angle points left
      } else if (motor2Percentage > 67) {
        startX = margin; // Start from left if angle points right
      } else {
        startX = size / 2; // Middle for upward angles
      }
    }

    // Calculate end point
    // In canvas coordinates: 0 degrees points left, 90 degrees points up
    const endX = startX - Math.cos(angleRadians) * lineLength;
    const endY = startY - Math.sin(angleRadians) * lineLength;


    // Draw the line
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    // Draw circles at start and end points
    ctx.fillStyle = lineColor;

    // Draw second line (motor 3)
    // Calculate end point for second line (same length as first line)
    const secondEndX = endX - Math.cos(secondLineAngleRadians) * lineLength;
    const secondEndY = endY - Math.sin(secondLineAngleRadians) * lineLength;
    
    // Draw the second line
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(secondEndX, secondEndY);
    ctx.stroke();

    // Draw third line (motor 4)
    // Calculate end point for third line
    const thirdEndX = secondEndX + Math.cos(thirdLineAngleRadians) * thirdLineLength;
    const thirdEndY = secondEndY + Math.sin(thirdLineAngleRadians) * thirdLineLength;
    
    // Draw the third line
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(secondEndX, secondEndY);
    ctx.lineTo(thirdEndX, thirdEndY);
    ctx.stroke();
    
    // Draw circle at end of third line with fill based on motor 6 percentage
    // First draw the outline circle
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(thirdEndX, thirdEndY, arcRadius, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Then draw the filled portion based on motor 6 percentage
    if (motor6Percentage > 0) {
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.moveTo(thirdEndX, thirdEndY);
      // Convert percentage to radians (0% = 0, 100% = 2π)
      // Start from top (-π/2) and go clockwise
      const fillAngle = ((100 - motor6Percentage) / 100) * 2 * Math.PI;
      ctx.arc(thirdEndX, thirdEndY, arcRadius, Math.PI / 2, Math.PI / 2 + fillAngle);
      ctx.closePath();
      ctx.fill();
    }

  }, [motorData, size, theme]);

  return (
    <div 
      style={{ 
        width: `${size}px`, 
        height: `${size}px`,
        position: 'absolute',
        top: '16px',
        right: '16px',
        zIndex: 10
      }}
    >
      <canvas 
        ref={canvasRef}
        style={{ 
          width: '100%', 
          height: '100%',
          display: 'block'
        }}
      />
    </div>
  );
};

export default BusStatusCanvas;
