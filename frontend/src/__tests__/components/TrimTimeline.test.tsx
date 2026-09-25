import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import TrimTimeline from '../../components/Voice/TrimTimeline';

describe('TrimTimeline', () => {
  const defaultProps = {
    startTime: 10,
    endTime: 50,
    currentTime: 30,
    maxDuration: 120,
    isMobile: false,
    onTimelineMouseDown: vi.fn(),
    onTimelineClick: vi.fn(),
    timelineRef: { current: null } as React.RefObject<HTMLDivElement | null>,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders start and end sliders with aria labels', () => {
    renderWithProviders(<TrimTimeline {...defaultProps} />);

    expect(screen.getByRole('slider', { name: /trim start time/i })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /trim end time/i })).toBeInTheDocument();
  });

  it('displays formatted start time in badge', () => {
    renderWithProviders(<TrimTimeline {...defaultProps} />);

    expect(screen.getByText('Start: 0:10')).toBeInTheDocument();
  });

  it('displays formatted end time in badge', () => {
    renderWithProviders(<TrimTimeline {...defaultProps} />);

    expect(screen.getByText('End: 0:50')).toBeInTheDocument();
  });

  it('displays duration badge', () => {
    // Duration = endTime - startTime = 50 - 10 = 40 seconds
    renderWithProviders(<TrimTimeline {...defaultProps} />);

    expect(screen.getByText('Duration: 0:40')).toBeInTheDocument();
  });

  it('shows correct time ruler marks for short duration (<=300s, 30s intervals)', () => {
    renderWithProviders(<TrimTimeline {...defaultProps} maxDuration={120} />);

    // Marks at 0, 30, 60, 90, 120 seconds
    expect(screen.getAllByText('0:00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('0:30').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('1:00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('1:30').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('2:00').length).toBeGreaterThanOrEqual(1);
  });

  it('shows correct time ruler marks for long duration (>300s, 60s intervals)', () => {
    renderWithProviders(<TrimTimeline {...defaultProps} maxDuration={360} />);

    // Marks at 0, 60, 120, 180, 240, 300, 360 seconds (60s intervals)
    expect(screen.getAllByText('0:00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('1:00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('2:00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('3:00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('4:00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('5:00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('6:00').length).toBeGreaterThanOrEqual(1);

    // Should NOT have 30s interval marks
    expect(screen.queryByText('0:30')).not.toBeInTheDocument();
    expect(screen.queryByText('1:30')).not.toBeInTheDocument();
  });

  it('calls onTimelineMouseDown with "start" when start handle receives mouseDown', () => {
    const onTimelineMouseDown = vi.fn();
    renderWithProviders(
      <TrimTimeline {...defaultProps} onTimelineMouseDown={onTimelineMouseDown} />,
    );

    const startSlider = screen.getByRole('slider', { name: /trim start time/i });
    fireEvent.mouseDown(startSlider);

    expect(onTimelineMouseDown).toHaveBeenCalledTimes(1);
    expect(onTimelineMouseDown).toHaveBeenCalledWith(expect.any(Object), 'start');
  });

  it('calls onTimelineMouseDown with "end" when end handle receives mouseDown', () => {
    const onTimelineMouseDown = vi.fn();
    renderWithProviders(
      <TrimTimeline {...defaultProps} onTimelineMouseDown={onTimelineMouseDown} />,
    );

    const endSlider = screen.getByRole('slider', { name: /trim end time/i });
    fireEvent.mouseDown(endSlider);

    expect(onTimelineMouseDown).toHaveBeenCalledTimes(1);
    expect(onTimelineMouseDown).toHaveBeenCalledWith(expect.any(Object), 'end');
  });

  it('renders help text about dragging handles', () => {
    renderWithProviders(<TrimTimeline {...defaultProps} />);

    expect(
      screen.getByText(/drag the green and red handles to adjust your clip range/i),
    ).toBeInTheDocument();
  });

  it('sets correct aria-valuenow on start slider', () => {
    renderWithProviders(<TrimTimeline {...defaultProps} startTime={15} />);

    const startSlider = screen.getByRole('slider', { name: /trim start time/i });
    expect(startSlider).toHaveAttribute('aria-valuenow', '15');
  });

  it('sets correct aria-valuenow on end slider', () => {
    renderWithProviders(<TrimTimeline {...defaultProps} endTime={90} />);

    const endSlider = screen.getByRole('slider', { name: /trim end time/i });
    expect(endSlider).toHaveAttribute('aria-valuenow', '90');
  });
});
