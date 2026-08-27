# Plain Ruby. Formats an inventory into a text report.
require_relative 'inventory'

module Report
  def self.render(warehouse)
    "#{warehouse.count} items on hand"
  end
end
