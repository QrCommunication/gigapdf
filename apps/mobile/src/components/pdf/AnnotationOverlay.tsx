/**
 * AnnotationOverlay Component
 * SVG-based overlay for drawing annotations on PDF pages
 */

import React, { useRef, useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  PanResponder,
  GestureResponderEvent,
  PanResponderGestureState,
} from 'react-native';
import Svg, {
  Path,
  Rect,
  Circle,
  Text as SvgText,
  G,
  Defs,
  Marker,
  Line,
  Polygon,
} from 'react-native-svg';
import {
  Annotation,
  Point,
  EditorTool,
  DrawingAnnotation,
  ShapeAnnotation,
  TextAnnotation,
  HighlightAnnotation,
} from '../../types/annotations';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

interface AnnotationOverlayProps {
  annotations: Annotation[];
  currentPage: number;
  activeTool: EditorTool;
  activeColor: string;
  strokeWidth: number;
  opacity: number;
  selectedAnnotationId: string | null;
  onAnnotationCreate: (annotation: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onAnnotationSelect: (id: string | null) => void;
  onAnnotationUpdate: (id: string, updates: Partial<Annotation>) => void;
  onTextInput?: (position: Point) => void;
  scale: number;
  pageWidth: number;
  pageHeight: number;
}

export const AnnotationOverlay: React.FC<AnnotationOverlayProps> = ({
  annotations,
  currentPage,
  activeTool,
  activeColor,
  strokeWidth,
  opacity,
  selectedAnnotationId,
  onAnnotationCreate,
  onAnnotationSelect,
  onAnnotationUpdate,
  onTextInput,
  scale,
  pageWidth,
  pageHeight,
}) => {
  const [currentPath, setCurrentPath] = useState<Point[]>([]);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [endPoint, setEndPoint] = useState<Point | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Filter annotations for current page
  const pageAnnotations = annotations.filter((a) => a.page === currentPage);

  const getEventPosition = useCallback(
    (event: GestureResponderEvent): Point => {
      const { locationX, locationY } = event.nativeEvent;
      return {
        x: locationX / scale,
        y: locationY / scale,
      };
    },
    [scale]
  );

  const handleTouchStart = useCallback(
    (event: GestureResponderEvent) => {
      if (activeTool === 'select') {
        // In select mode, we handle selection via annotation touch
        return;
      }

      const pos = getEventPosition(event);
      setIsDrawing(true);
      setStartPoint(pos);

      if (activeTool === 'drawing') {
        setCurrentPath([pos]);
      } else if (activeTool === 'text') {
        // Open text input modal
        onTextInput?.(pos);
      }
    },
    [activeTool, getEventPosition, onTextInput]
  );

  const handleTouchMove = useCallback(
    (event: GestureResponderEvent) => {
      if (!isDrawing || activeTool === 'select') return;

      const pos = getEventPosition(event);
      setEndPoint(pos);

      if (activeTool === 'drawing') {
        setCurrentPath((prev) => [...prev, pos]);
      }
    },
    [isDrawing, activeTool, getEventPosition]
  );

  const handleTouchEnd = useCallback(() => {
    if (!isDrawing || !startPoint) {
      setIsDrawing(false);
      return;
    }

    if (activeTool === 'drawing' && currentPath.length > 1) {
      const drawingAnnotation: Omit<DrawingAnnotation, 'id' | 'createdAt' | 'updatedAt'> = {
        type: 'drawing',
        page: currentPage,
        color: activeColor,
        opacity,
        points: currentPath,
        strokeWidth,
      };
      onAnnotationCreate(drawingAnnotation);
    } else if (['rectangle', 'circle', 'arrow'].includes(activeTool) && endPoint) {
      const shapeAnnotation: Omit<ShapeAnnotation, 'id' | 'createdAt' | 'updatedAt'> = {
        type: activeTool as 'rectangle' | 'circle' | 'arrow',
        page: currentPage,
        color: activeColor,
        opacity,
        startPoint,
        endPoint,
        strokeWidth,
        filled: false,
      };
      onAnnotationCreate(shapeAnnotation);
    } else if (activeTool === 'highlight' && endPoint) {
      const highlightAnnotation: Omit<HighlightAnnotation, 'id' | 'createdAt' | 'updatedAt'> = {
        type: 'highlight',
        page: currentPage,
        color: activeColor,
        opacity: 0.3,
        startPoint,
        endPoint,
        rects: [
          {
            x: Math.min(startPoint.x, endPoint.x),
            y: Math.min(startPoint.y, endPoint.y),
            width: Math.abs(endPoint.x - startPoint.x),
            height: Math.abs(endPoint.y - startPoint.y),
          },
        ],
      };
      onAnnotationCreate(highlightAnnotation);
    }

    // Reset state
    setIsDrawing(false);
    setCurrentPath([]);
    setStartPoint(null);
    setEndPoint(null);
  }, [
    isDrawing,
    startPoint,
    endPoint,
    activeTool,
    currentPath,
    currentPage,
    activeColor,
    opacity,
    strokeWidth,
    onAnnotationCreate,
  ]);

  const handleAnnotationPress = useCallback(
    (id: string) => {
      if (activeTool === 'select') {
        onAnnotationSelect(selectedAnnotationId === id ? null : id);
      } else if (activeTool === 'eraser') {
        // Delete annotation
        onAnnotationUpdate(id, { type: 'deleted' } as any);
      }
    },
    [activeTool, selectedAnnotationId, onAnnotationSelect, onAnnotationUpdate]
  );

  // Generate path string for drawing
  const pathToSvg = (points: Point[]): string => {
    if (points.length === 0) return '';
    const [first, ...rest] = points;
    return `M${first.x},${first.y} ${rest.map((p) => `L${p.x},${p.y}`).join(' ')}`;
  };

  // Render individual annotation
  const renderAnnotation = (annotation: Annotation) => {
    const isSelected = annotation.id === selectedAnnotationId;
    const selectionStroke = isSelected ? '#0066FF' : 'transparent';
    const selectionStrokeWidth = isSelected ? 2 : 0;

    switch (annotation.type) {
      case 'drawing': {
        const drawing = annotation as DrawingAnnotation;
        return (
          <Path
            key={annotation.id}
            d={pathToSvg(drawing.points)}
            stroke={drawing.color}
            strokeWidth={drawing.strokeWidth}
            strokeOpacity={drawing.opacity}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            onPress={() => handleAnnotationPress(annotation.id)}
          />
        );
      }

      case 'rectangle': {
        const rect = annotation as ShapeAnnotation;
        const x = Math.min(rect.startPoint.x, rect.endPoint.x);
        const y = Math.min(rect.startPoint.y, rect.endPoint.y);
        const width = Math.abs(rect.endPoint.x - rect.startPoint.x);
        const height = Math.abs(rect.endPoint.y - rect.startPoint.y);
        return (
          <G key={annotation.id}>
            <Rect
              x={x}
              y={y}
              width={width}
              height={height}
              stroke={rect.color}
              strokeWidth={rect.strokeWidth}
              strokeOpacity={rect.opacity}
              fill={rect.filled ? rect.fillColor || rect.color : 'none'}
              fillOpacity={rect.filled ? 0.2 : 0}
              onPress={() => handleAnnotationPress(annotation.id)}
            />
            {isSelected && (
              <Rect
                x={x - 2}
                y={y - 2}
                width={width + 4}
                height={height + 4}
                stroke={selectionStroke}
                strokeWidth={selectionStrokeWidth}
                fill="none"
                strokeDasharray="4,4"
              />
            )}
          </G>
        );
      }

      case 'circle': {
        const circle = annotation as ShapeAnnotation;
        const cx = (circle.startPoint.x + circle.endPoint.x) / 2;
        const cy = (circle.startPoint.y + circle.endPoint.y) / 2;
        const rx = Math.abs(circle.endPoint.x - circle.startPoint.x) / 2;
        const ry = Math.abs(circle.endPoint.y - circle.startPoint.y) / 2;
        return (
          <G key={annotation.id}>
            <Circle
              cx={cx}
              cy={cy}
              r={Math.min(rx, ry)}
              stroke={circle.color}
              strokeWidth={circle.strokeWidth}
              strokeOpacity={circle.opacity}
              fill={circle.filled ? circle.fillColor || circle.color : 'none'}
              fillOpacity={circle.filled ? 0.2 : 0}
              onPress={() => handleAnnotationPress(annotation.id)}
            />
          </G>
        );
      }

      case 'arrow': {
        const arrow = annotation as ShapeAnnotation;
        const angle = Math.atan2(
          arrow.endPoint.y - arrow.startPoint.y,
          arrow.endPoint.x - arrow.startPoint.x
        );
        const headLength = 15;
        const head1 = {
          x: arrow.endPoint.x - headLength * Math.cos(angle - Math.PI / 6),
          y: arrow.endPoint.y - headLength * Math.sin(angle - Math.PI / 6),
        };
        const head2 = {
          x: arrow.endPoint.x - headLength * Math.cos(angle + Math.PI / 6),
          y: arrow.endPoint.y - headLength * Math.sin(angle + Math.PI / 6),
        };
        return (
          <G key={annotation.id}>
            <Line
              x1={arrow.startPoint.x}
              y1={arrow.startPoint.y}
              x2={arrow.endPoint.x}
              y2={arrow.endPoint.y}
              stroke={arrow.color}
              strokeWidth={arrow.strokeWidth}
              strokeOpacity={arrow.opacity}
              onPress={() => handleAnnotationPress(annotation.id)}
            />
            <Polygon
              points={`${arrow.endPoint.x},${arrow.endPoint.y} ${head1.x},${head1.y} ${head2.x},${head2.y}`}
              fill={arrow.color}
              fillOpacity={arrow.opacity}
            />
          </G>
        );
      }

      case 'highlight': {
        const highlight = annotation as HighlightAnnotation;
        return (
          <G key={annotation.id}>
            {highlight.rects.map((rect, i) => (
              <Rect
                key={`${annotation.id}-${i}`}
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                fill={highlight.color}
                fillOpacity={highlight.opacity}
                onPress={() => handleAnnotationPress(annotation.id)}
              />
            ))}
          </G>
        );
      }

      case 'text': {
        const text = annotation as TextAnnotation;
        return (
          <SvgText
            key={annotation.id}
            x={text.position.x}
            y={text.position.y}
            fill={text.color}
            fillOpacity={text.opacity}
            fontSize={text.fontSize}
            fontWeight={text.fontWeight}
            fontStyle={text.fontStyle}
            onPress={() => handleAnnotationPress(annotation.id)}
          >
            {text.content}
          </SvgText>
        );
      }

      default:
        return null;
    }
  };

  // Render current drawing preview
  const renderCurrentDrawing = () => {
    if (!isDrawing) return null;

    if (activeTool === 'drawing' && currentPath.length > 1) {
      return (
        <Path
          d={pathToSvg(currentPath)}
          stroke={activeColor}
          strokeWidth={strokeWidth}
          strokeOpacity={opacity}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    }

    if (startPoint && endPoint) {
      if (activeTool === 'rectangle') {
        const x = Math.min(startPoint.x, endPoint.x);
        const y = Math.min(startPoint.y, endPoint.y);
        const width = Math.abs(endPoint.x - startPoint.x);
        const height = Math.abs(endPoint.y - startPoint.y);
        return (
          <Rect
            x={x}
            y={y}
            width={width}
            height={height}
            stroke={activeColor}
            strokeWidth={strokeWidth}
            strokeOpacity={opacity}
            fill="none"
            strokeDasharray="4,4"
          />
        );
      }

      if (activeTool === 'circle') {
        const cx = (startPoint.x + endPoint.x) / 2;
        const cy = (startPoint.y + endPoint.y) / 2;
        const rx = Math.abs(endPoint.x - startPoint.x) / 2;
        const ry = Math.abs(endPoint.y - startPoint.y) / 2;
        return (
          <Circle
            cx={cx}
            cy={cy}
            r={Math.min(rx, ry)}
            stroke={activeColor}
            strokeWidth={strokeWidth}
            strokeOpacity={opacity}
            fill="none"
            strokeDasharray="4,4"
          />
        );
      }

      if (activeTool === 'arrow' || activeTool === 'highlight') {
        return (
          <Line
            x1={startPoint.x}
            y1={startPoint.y}
            x2={endPoint.x}
            y2={endPoint.y}
            stroke={activeColor}
            strokeWidth={strokeWidth}
            strokeOpacity={opacity}
            strokeDasharray="4,4"
          />
        );
      }
    }

    return null;
  };

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => activeTool !== 'select',
    onMoveShouldSetPanResponder: () => activeTool !== 'select',
    onPanResponderGrant: (e) => handleTouchStart(e),
    onPanResponderMove: (e) => handleTouchMove(e),
    onPanResponderRelease: () => handleTouchEnd(),
    onPanResponderTerminate: () => handleTouchEnd(),
  });

  return (
    <View
      style={[styles.container, { width: pageWidth * scale, height: pageHeight * scale }]}
      {...(activeTool !== 'select' ? panResponder.panHandlers : {})}
    >
      <Svg
        width={pageWidth * scale}
        height={pageHeight * scale}
        viewBox={`0 0 ${pageWidth} ${pageHeight}`}
      >
        {/* Render existing annotations */}
        {pageAnnotations.map(renderAnnotation)}

        {/* Render current drawing preview */}
        {renderCurrentDrawing()}
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});

export default AnnotationOverlay;
