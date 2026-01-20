import React from 'react';

interface PopoverSurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export const PopoverSurface: React.FC<PopoverSurfaceProps> = ({
  className = '',
  children,
  ...rest
}) => (
  <div className={`popover-container ${className}`.trim()} {...rest}>
    {children}
  </div>
);
