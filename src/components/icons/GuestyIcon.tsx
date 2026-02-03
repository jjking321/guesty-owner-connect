import React from 'react';

interface GuestyIconProps {
  className?: string;
}

export const GuestyIcon: React.FC<GuestyIconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 69 68"
    className={className}
  >
    <path
      fill="#3b9dff"
      d="M63.6,26.3c0-.8-.4-1.5-1-2L37,6.4c-.4-.4-1-.6-1.5-.6h-.2c-.6,0-1.1.3-1.5.6L8,24.3c-.6.5-1,1.2-1,2v33.5c0,1.3,1.1,2.4,2.4,2.4h38.5c1.3,0,2.4-1.1,2.4-2.4v-26.8c0-.8-.3-1.6-1-2l-12.3-8.7c-.4-.4-1-.6-1.5-.6h-.2c-.6,0-1.1.3-1.5.6l-12.5,8.7c-.6.5-1,1.2-1,2v13.6c0,1.3,1.1,2.4,2.4,2.4s2.4-1.1,2.4-2.4h0v-12.4l10.2-7.2,10.2,7.2v23.3H11.8v-30l23.5-16.4,23.5,16.5v32.4c0,1.3,1.1,2.4,2.4,2.4s2.4-1.1,2.4-2.4V26.3"
    />
  </svg>
);

export default GuestyIcon;
